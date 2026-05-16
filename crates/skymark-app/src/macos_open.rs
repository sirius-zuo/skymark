use std::ffi::{c_char, c_void, CStr};
use std::io::Write;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::OnceLock;

use objc2::ffi::{class_addMethod, object_getClass};
use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
use objc2::{class, msg_send, sel};
use tauri::Manager;

type Id = *mut AnyObject;

const K_CORE_EVENT_CLASS: u32 = u32::from_be_bytes(*b"aevt");
const K_AE_OPEN_DOCUMENTS: u32 = u32::from_be_bytes(*b"odoc");
const KEY_DIRECT_OBJECT: u32 = u32::from_be_bytes(*b"----");

static OPEN_FN: OnceLock<Box<dyn Fn(String) + Send + Sync>> = OnceLock::new();
/// Retained instance of SkymarkAEHandler; lives for the process lifetime.
static AE_HANDLER_INST: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());

extern "C" {
    // dispatch_get_main_queue() is an inline C function; the real symbol is this global.
    // Taking its address gives the dispatch_queue_t pointer for the main queue.
    static _dispatch_main_q: u8;
    fn dispatch_async_f(
        queue: *mut c_void,
        context: *mut c_void,
        work: unsafe extern "C" fn(*mut c_void),
    );
    fn objc_allocateClassPair(
        superclass: *const AnyClass,
        name: *const c_char,
        extra_bytes: usize,
    ) -> *mut AnyClass;
    fn objc_registerClassPair(cls: *mut AnyClass);
}

fn log(msg: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/skymark_ae.log")
    {
        let _ = writeln!(f, "[pid={}] {}", std::process::id(), msg);
    }
}

pub fn install<R: tauri::Runtime>(handle: &tauri::AppHandle<R>) {
    use tauri::Emitter;
    let handle = handle.clone();
    let _ = OPEN_FN.set(Box::new(move |path: String| {
        log(&format!("OPEN_FN: path = {path}"));
        if let Some(state) = handle.try_state::<crate::PendingOpen>() {
            *state.0.lock().unwrap() = Some(path.clone());
        }
        let _ = handle.emit("skymark://open-file", path);
    }));
    unsafe { setup_handlers() };
}

unsafe fn setup_handlers() {
    log("setup_handlers: start");

    // Create a dedicated SkymarkAEHandler : NSObject class.
    // Using a new class avoids the need to swizzle Tao's delegate, which
    // silently fails because method_setImplementation doesn't take effect there.
    let superclass = class!(NSObject) as *const AnyClass;
    let new_cls = objc_allocateClassPair(superclass, c"SkymarkAEHandler".as_ptr(), 0);
    if new_cls.is_null() {
        // Already registered — this shouldn't happen in a single process, but handle gracefully.
        log("setup_handlers: SkymarkAEHandler already registered, skipping");
        return;
    }

    let ae_fn: unsafe extern "C-unwind" fn(Id, Sel, Id, Id) = ae_open_handler;
    class_addMethod(
        new_cls,
        sel!(skymarkHandleOpenDocument:withReplyEvent:),
        std::mem::transmute(ae_fn),
        c"v@:@@".as_ptr() as *const c_char,
    );

    objc_registerClassPair(new_cls);
    log("setup_handlers: SkymarkAEHandler class registered");

    // Allocate a persistent instance (+new returns a +1 retained object).
    let inst: Id = msg_send![new_cls as *const AnyClass, new];
    if inst.is_null() {
        log("setup_handlers: failed to allocate SkymarkAEHandler instance");
        return;
    }
    AE_HANDLER_INST.store(inst, Ordering::Relaxed);
    log("setup_handlers: SkymarkAEHandler instance created");

    // Belt-and-suspenders: also inject application:openFile: into Tao's delegate
    // (works because class_addMethod succeeds for new selectors).
    inject_open_file_delegate();

    // Register with NSAppleEventManager now.
    do_register_ae_handler(inst);

    // [NSApplication run] → finishLaunching may overwrite our NSAppleEventManager registration.
    // dispatch_async on the main queue fires after finishLaunching returns, re-winning the slot.
    // _dispatch_main_q is the real GCD symbol; dispatch_get_main_queue() is just an inline wrapper.
    let main_q = &_dispatch_main_q as *const u8 as *mut c_void;
    dispatch_async_f(main_q, std::ptr::null_mut(), after_finish_launching);
    log("setup_handlers: dispatch_async queued for post-launch re-registration");
}

unsafe fn inject_open_file_delegate() {
    let app: Id = msg_send![class!(NSApplication), sharedApplication];
    if app.is_null() {
        return;
    }
    let delegate: Id = msg_send![app, delegate];
    if delegate.is_null() {
        return;
    }
    let cls = object_getClass(delegate as *const AnyObject) as *mut AnyClass;
    if cls.is_null() {
        return;
    }
    let file_fn: unsafe extern "C-unwind" fn(Id, Sel, Id, Id) -> Bool = open_file_handler;
    let r = class_addMethod(
        cls,
        sel!(application:openFile:),
        std::mem::transmute(file_fn),
        c"B@:@@".as_ptr() as *const c_char,
    );
    log(&format!(
        "inject_open_file_delegate: application:openFile: added = {}",
        r.as_bool()
    ));
}

unsafe fn do_register_ae_handler(inst: Id) {
    let ae_mgr: Id = msg_send![class!(NSAppleEventManager), sharedAppleEventManager];
    if ae_mgr.is_null() {
        log("do_register_ae_handler: NSAppleEventManager is null");
        return;
    }
    let _: () = msg_send![
        ae_mgr,
        setEventHandler: inst,
        andSelector: sel!(skymarkHandleOpenDocument:withReplyEvent:),
        forEventClass: K_CORE_EVENT_CLASS,
        andEventID: K_AE_OPEN_DOCUMENTS
    ];
    log("do_register_ae_handler: registered");
}

/// Fires on the main queue after [NSApplication run] has completed finishLaunching.
/// Re-registers our handler so it wins over whatever NSApplication set up.
unsafe extern "C" fn after_finish_launching(_ctx: *mut c_void) {
    log("after_finish_launching: fired on main queue");
    let inst = AE_HANDLER_INST.load(Ordering::Relaxed);
    if inst.is_null() {
        log("after_finish_launching: instance is null!");
        return;
    }
    do_register_ae_handler(inst);
}

unsafe extern "C-unwind" fn ae_open_handler(_this: Id, _sel: Sel, event: Id, _reply: Id) {
    log("ae_open_handler: called");
    let direct: Id = msg_send![event, paramDescriptorForKeyword: KEY_DIRECT_OBJECT];
    if direct.is_null() {
        log("ae_open_handler: direct object is null");
        return;
    }
    let count: i64 = msg_send![direct, numberOfItems];
    log(&format!("ae_open_handler: numberOfItems = {count}"));
    if count == 0 {
        open_descriptor(direct);
    } else {
        for i in 1i64..=count {
            let item: Id = msg_send![direct, descriptorAtIndex: i];
            if item.is_null() {
                continue;
            }
            if open_descriptor(item) {
                break;
            }
        }
    }
}

unsafe fn open_descriptor(desc: Id) -> bool {
    let url: Id = msg_send![desc, fileURLValue];
    if url.is_null() {
        return false;
    }
    let path_ns: Id = msg_send![url, path];
    if path_ns.is_null() {
        return false;
    }
    let utf8: *const c_char = msg_send![path_ns, UTF8String];
    if utf8.is_null() {
        return false;
    }
    if let Ok(s) = CStr::from_ptr(utf8).to_str() {
        log(&format!("open_descriptor: path = {s}"));
        if let Some(f) = OPEN_FN.get() {
            f(s.to_owned());
            return true;
        }
    }
    false
}

unsafe extern "C-unwind" fn open_file_handler(
    _this: Id,
    _sel: Sel,
    _sender: Id,
    filename: Id,
) -> Bool {
    log("open_file_handler: called");
    if filename.is_null() {
        return Bool::NO;
    }
    let utf8: *const c_char = msg_send![filename, UTF8String];
    if utf8.is_null() {
        return Bool::NO;
    }
    if let Ok(s) = CStr::from_ptr(utf8).to_str() {
        log(&format!("open_file_handler: path = {s}"));
        if let Some(f) = OPEN_FN.get() {
            f(s.to_owned());
        }
    }
    Bool::YES
}

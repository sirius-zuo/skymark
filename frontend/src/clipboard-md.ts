import TurndownService from "turndown";
import { gfm } from "@truto/turndown-plugin-gfm";

const service = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
service.use(gfm);

export function htmlToMarkdown(html: string): string {
  return service.turndown(html).trim();
}

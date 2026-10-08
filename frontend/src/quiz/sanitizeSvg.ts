// Typst output goes into the page with v-html, and the Typst source can come
// from anyone (a `?src=` link, SPEC.md §3.5), so its SVG is untrusted markup.
// typst.ts escapes text properly, but carries a link's URL through verbatim:
// `#link("javascript:...")` becomes `<a xlink:href="javascript:...">`. It also
// embeds its own (inert under v-html) <script>. Everything that could run
// code is stripped here, leaving the drawing itself untouched.

// Links a quiz may keep: the web, mail, and in-document anchors.
const SAFE_LINK = /^(?:https?:|mailto:|#)/i;
// typst.ts embeds images (including SVG ones, which cannot run script as an
// <image>) as data: URIs.
const SAFE_IMAGE = /^data:image\//i;

// SMIL animations are on the list because they can rewrite an href to
// `javascript:` after sanitizing.
const FORBIDDEN_ELEMENTS = "script, iframe, object, embed, animate, set, animateMotion, animateTransform";

export function sanitizeSvg(svg: string): string {
  // Parsed as HTML, not XML: that is how v-html will parse it, so this sees
  // exactly the tree that would be mounted -- and typst.ts output is not
  // well-formed XML anyway (its embedded script contains a bare `&&`).
  const doc = new DOMParser().parseFromString(svg, "text/html");

  doc.body.querySelectorAll(FORBIDDEN_ELEMENTS).forEach((element) => element.remove());

  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      // Browsers ignore control characters and spaces when reading a URL's
      // scheme, so "java\tscript:" must not slip past the checks below.
      const value = attr.value.replace(/[\u0000- ]/g, "");
      if (/^on/i.test(attr.localName)) {
        element.removeAttributeNode(attr);
      } else if (attr.localName === "href" || attr.localName === "src" || attr.localName === "action") {
        const safe = SAFE_LINK.test(value) || (element.localName === "image" && SAFE_IMAGE.test(value));
        if (!safe) element.removeAttributeNode(attr);
      }
    }
  }
  return doc.body.innerHTML;
}

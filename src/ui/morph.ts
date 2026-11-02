// Minimal DOM morph: patch an element's children to match new HTML while keeping the
// existing nodes where the shape is the same. Buttons under the cursor stay the same
// node across re-renders, so clicks and hovers are never lost to a refresh.
export function morph(el: Element, html: string) {
  const t = document.createElement(el.namespaceURI === 'http://www.w3.org/2000/svg' ? 'div' : 'template') as any;
  t.innerHTML = html;
  patchChildren(el, (t.content || t) as ParentNode);
}

function patchChildren(a: ParentNode, b: ParentNode) {
  const an = Array.from(a.childNodes), bn = Array.from(b.childNodes);
  for (let i = 0; i < bn.length; i++) {
    const x = an[i], y = bn[i];
    if (!x) { a.appendChild(y.cloneNode(true)); continue; }
    if (!same(x, y)) { a.replaceChild(y.cloneNode(true), x); continue; }
    if (x.nodeType === 3 || x.nodeType === 8) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
    patchAttrs(x as Element, y as Element);
    if (x.nodeName === 'INPUT' || x.nodeName === 'TEXTAREA') continue; // keep what the user typed
    patchChildren(x as Element, y as Element);
  }
  for (let i = an.length - 1; i >= bn.length; i--) a.removeChild(an[i]);
}
function same(x: Node, y: Node) {
  if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) return false;
  if (x.nodeType !== 1) return true;
  // Elements carrying an action keep identity only if it is the same action.
  const ex = x as Element, ey = y as Element;
  return ex.getAttribute('data-act') === ey.getAttribute('data-act') && ex.getAttribute('data-v') === ey.getAttribute('data-v');
}
function patchAttrs(x: Element, y: Element) {
  for (const at of Array.from(x.attributes)) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
  for (const at of Array.from(y.attributes)) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
  if ((x as any).disabled !== undefined) (x as any).disabled = (y as HTMLButtonElement).hasAttribute('disabled');
}
/** Same, for the children of an <svg> element. */
export function morphSvg(el: SVGSVGElement, inner: string) {
  const t = document.createElement('template');
  t.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>';
  patchChildren(el, t.content.firstChild as unknown as ParentNode);
}

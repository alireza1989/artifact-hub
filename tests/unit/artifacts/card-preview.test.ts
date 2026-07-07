import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { CardPreview } from "@/components/artifacts/card-preview";
import type { Artifact } from "@/db/schema";

// Phase 6.2 gallery-card previews: HTML/SVG cards must carry the same sandbox
// model as the full-page preview (CLAUDE.md invariant: artifact HTML/SVG renders
// only inside sandbox-attribute iframes), stay inert (pointer-events-none,
// tabIndex -1) and lazy-load. These tests resolve the server-component element
// tree directly — no DOM renderer needed to assert props.

type Props = Record<string, unknown> & { children?: ReactNode };
type El = ReactElement<Props>;

function isElement(node: unknown): node is El {
  return typeof node === "object" && node !== null && "type" in node && "props" in node;
}

// Resolve plain function components (sync or async) to host elements, depth-first.
// Stops at host tags and exotic components (forwardRef icons), which is all we need.
async function resolveTree(node: unknown): Promise<unknown> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveTree));
  if (!isElement(node)) return node;
  if (typeof node.type === "function") {
    const rendered = await (node.type as (props: Props) => unknown)(node.props);
    return resolveTree(rendered);
  }
  const children = await resolveTree(node.props.children);
  return { ...node, props: { ...node.props, children } };
}

function findByTag(node: unknown, tag: string): El | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByTag(child, tag);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isElement(node)) return undefined;
  if (node.type === tag) return node;
  return findByTag(node.props.children, tag);
}

const fake = (kind: Artifact["kind"]): Pick<Artifact, "id" | "kind"> => ({
  id: "a_cardtest01",
  kind,
});

async function render(kind: Artifact["kind"]): Promise<unknown> {
  return resolveTree(await CardPreview({ artifact: fake(kind) }));
}

describe("CardPreview sandboxing and inertness", () => {
  it("renders HTML in an iframe with a script-permitting sandbox, inert and lazy", async () => {
    const iframe = findByTag(await render("html"), "iframe");
    expect(iframe).toBeDefined();
    expect(iframe?.props.sandbox).toBe("allow-scripts");
    expect(iframe?.props.loading).toBe("lazy");
    expect(iframe?.props.tabIndex).toBe(-1);
    expect(iframe?.props["aria-hidden"]).toBe("true");
    expect(String(iframe?.props.className)).toContain("pointer-events-none");
    expect(iframe?.props.src).toBe("/raw/a_cardtest01");
  });

  it("renders SVG via <img> — script-inert by spec, never a frame", async () => {
    const tree = await render("svg");
    expect(findByTag(tree, "iframe")).toBeUndefined();
    const img = findByTag(tree, "img");
    expect(img).toBeDefined();
    expect(img?.props.src).toBe("/raw/a_cardtest01");
    expect(img?.props.loading).toBe("lazy");
  });

  it("renders PDF via the browser viewer iframe, inert and lazy", async () => {
    const iframe = findByTag(await render("pdf"), "iframe");
    expect(iframe).toBeDefined();
    expect(iframe?.props.loading).toBe("lazy");
    expect(iframe?.props.tabIndex).toBe(-1);
    expect(String(iframe?.props.className)).toContain("pointer-events-none");
  });

  it("renders images as a plain <img> from /raw", async () => {
    const img = findByTag(await render("image"), "img");
    expect(img).toBeDefined();
    expect(img?.props.src).toBe("/raw/a_cardtest01");
    expect(img?.props.loading).toBe("lazy");
  });

  it("falls back to the kind icon for kinds with no inline preview", async () => {
    const tree = await render("other");
    expect(findByTag(tree, "iframe")).toBeUndefined();
    expect(findByTag(tree, "img")).toBeUndefined();
    expect(findByTag(tree, "pre")).toBeUndefined();
  });
});

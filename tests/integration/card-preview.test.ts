import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { CardPreview } from "@/components/artifacts/card-preview";
import { createArtifact } from "@/core/artifacts";

// Phase 6.2: the text-kind card snippet is fetched server-side from real storage,
// so it lives in the integration suite (test DB + in-memory storage fake). The
// failure path matters most: one unreadable artifact must degrade to the icon,
// never break the gallery.

type Props = Record<string, unknown> & { children?: ReactNode };
type El = ReactElement<Props>;

function isElement(node: unknown): node is El {
  return typeof node === "object" && node !== null && "type" in node && "props" in node;
}

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

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isElement(node)) return textOf(node.props.children);
  return "";
}

const enc = (s: string) => new TextEncoder().encode(s);

describe("CardPreview text snippets (integration)", () => {
  it("renders the first lines of a markdown artifact as an inert snippet", async () => {
    const a = await createArtifact({
      bytes: enc("# Release notes\n\n- fixed the header\n- new share flow"),
      filename: "notes.md",
      source: "api",
    });
    const tree = await resolveTree(await CardPreview({ artifact: a }));
    const pre = findByTag(tree, "pre");
    expect(pre).toBeDefined();
    expect(textOf(pre)).toContain("# Release notes");
    // Inert: the snippet is decoration; the card link is the interaction target.
    const wrapper = findByTag(tree, "div");
    expect(wrapper?.props["aria-hidden"]).toBe("true");
  });

  it("caps the snippet instead of dumping the whole file", async () => {
    const a = await createArtifact({
      bytes: enc(`start-marker\n${"x".repeat(5000)}\nend-marker`),
      filename: "big.txt",
      source: "api",
    });
    const tree = await resolveTree(await CardPreview({ artifact: a }));
    const text = textOf(findByTag(tree, "pre"));
    expect(text).toContain("start-marker");
    expect(text).not.toContain("end-marker");
    expect(text.length).toBeLessThanOrEqual(1600);
  });

  it("falls back to the kind icon when the artifact cannot be read", async () => {
    const tree = await resolveTree(
      await CardPreview({ artifact: { id: "a_missing00", kind: "markdown" } }),
    );
    expect(findByTag(tree, "pre")).toBeUndefined();
    expect(findByTag(tree, "iframe")).toBeUndefined();
  });

  it("falls back to the kind icon for whitespace-only content", async () => {
    const a = await createArtifact({
      bytes: enc("   \n\n   "),
      filename: "empty.txt",
      source: "api",
    });
    const tree = await resolveTree(await CardPreview({ artifact: a }));
    expect(findByTag(tree, "pre")).toBeUndefined();
  });
});

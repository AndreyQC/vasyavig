import {describe, expect, it} from "vitest";
import {imageSrcExtension} from "./imageSrcExtension";
import type {Extension} from "@gravity-ui/markdown-editor";

/** Минимальный мок ExtensionBuilder: захватывает serializer-spec и plugin-фабрики. */
function makeMockBuilder() {
  const serializers = new Map<string, unknown>();
  const pluginFactories: unknown[] = [];
  return {
    builders: {serializers, pluginFactories},
    builder: {
      overrideNodeSerializerSpec: (name: string, cb: (prev: unknown) => unknown) => {
        serializers.set(name, cb(null));
      },
      addPlugin: (factory: unknown) => {
        pluginFactories.push(factory);
      },
    } as unknown as Parameters<Extension>[0],
  };
}

/** Мок SerializerState: esc как у prosemirror-markdown (экранирует _), write пишет в out. */
function makeMockState() {
  let out = "";
  return {
    out: () => out,
    state: {
      esc: (s: string) => s.replace(/[_*[\]]/g, "\\$&"),
      write: (s: string) => {
        out += s;
      },
    },
  };
}

describe("imageSrcExtension: сериализация image-ноды (phase 5)", () => {
  const run = () => {
    const {builder, builders} = makeMockBuilder();
    imageSrcExtension("C:\\docs", () => null)(builder);
    return builders.serializers.get("image") as (state: unknown, node: unknown) => void;
  };

  it("путь с пробелами оборачивается в <...> без \\\\-экранирования", () => {
    const serialize = run();
    const {state, out} = makeMockState();
    serialize(state, {
      attrs: {src: "V2_ТЗ Total   (1)_assets/img-0.png", alt: null, title: null, loading: null},
    });
    expect(out()).toBe("![](<V2_ТЗ Total   (1)_assets/img-0.png>)");
  });

  it("путь без пробелов пишется bare, _ не экранируется", () => {
    const serialize = run();
    const {state, out} = makeMockState();
    serialize(state, {attrs: {src: "assets/my_pic.png", alt: "рис", title: null, loading: null}});
    expect(out()).toBe("![рис](assets/my_pic.png)");
  });

  it("title с кавычкой берётся в одинарные, <> экранируются", () => {
    const serialize = run();
    const {state, out} = makeMockState();
    serialize(state, {attrs: {src: "a<b>c.png", alt: null, title: 'под"сказка', loading: null}});
    expect(out()).toBe("![](a\\<b\\>c.png 'под\"сказка')");
  });

  it("src в угловой форме с backslash внутри экранируется", () => {
    const serialize = run();
    const {state, out} = makeMockState();
    serialize(state, {attrs: {src: "dir\\file name.png", alt: null, title: null, loading: null}});
    expect(out()).toBe("![](<dir\\\\file name.png>)");
  });
});

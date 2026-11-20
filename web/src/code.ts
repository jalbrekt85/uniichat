// Syntax highlighting for rendered Markdown code blocks, using the code
// block's own language label from Md/Html. No language: let highlight.js
// infer only for short, non-diff snippets.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

for (const [name, language] of Object.entries({ bash, c, cpp, css, diff, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml })) {
  hljs.registerLanguage(name, language as never);
}

const ALIASES: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  sh: "bash", shell: "bash", zsh: "bash", console: "bash",
  py: "python", yml: "yaml", md: "markdown", html: "xml", svg: "xml",
  rs: "rust", golang: "go", "c++": "cpp", h: "c", hpp: "cpp",
};

export function highlightCode(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("pre > code").forEach((code) => {
    if (code.dataset.highlighted === "yes") return;
    const pre = code.closest("pre");
    if (pre === null || pre.classList.contains("diff")) {
      code.dataset.highlighted = "yes";
      return;
    }
    const classLang = [...code.classList].find((name) => name.startsWith("language-"))?.slice(9) ?? "";
    if (pre.dataset.output !== undefined && classLang === "") {
      code.dataset.highlighted = "yes";
      return;
    }
    const label = (classLang !== "" ? classLang : (pre.querySelector<HTMLElement>(".lang")?.textContent ?? "")).trim().toLowerCase();
    const name = ALIASES[label] ?? label;
    const text = code.textContent ?? "";
    try {
      if (name !== "" && hljs.getLanguage(name) !== undefined) {
        hljs.highlightElement(code);
      } else if (text.includes("\n") && text.length <= 12000) {
        const result = hljs.highlightAuto(text);
        code.innerHTML = result.value;
        code.classList.add("hljs");
      }
    } catch {
      // a bad fence should never break the message
    }
    code.dataset.highlighted = "yes";
  });
}

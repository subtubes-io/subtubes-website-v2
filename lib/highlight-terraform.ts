import type { HLJSApi, Language, Mode } from "highlight.js";

// highlight.js has no Terraform (HCL) grammar, so this is a small one: block keywords, attributes, strings with ${...}
// interpolation, numbers, comments and the literals true, false and null.
export default function terraform(hljs: HLJSApi): Language {
  const interpolation: Mode = {
    className: "subst",
    begin: /\$\{/,
    end: /\}/,
    keywords: { literal: "true false null" },
    contains: [{ begin: /\{/, end: /\}/, contains: ["self"] }],
  };
  const string: Mode = {
    className: "string",
    begin: /"/,
    end: /"/,
    contains: [{ begin: /\\./ }, interpolation],
  };
  const heredoc = hljs.END_SAME_AS_BEGIN({
    className: "string",
    begin: /<<-?\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/m,
    end: /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/m,
    contains: [interpolation],
  });

  return {
    name: "Terraform",
    aliases: ["tf", "hcl"],
    keywords: {
      keyword: "resource variable output module provider data locals terraform moved import check for_each for in if",
      literal: "true false null",
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      heredoc,
      string,
      hljs.C_NUMBER_MODE,
      { className: "attr", begin: /^\s*[A-Za-z_][A-Za-z0-9_-]*(?=\s*=)/ },
    ],
  };
}

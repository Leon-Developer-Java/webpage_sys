import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

const OPEN = "";
const CLOSE = "";

// CommonMark 的强调“flanking”规则导致 **加粗** 紧贴中文/中文标点时不生效
// （如 我是**「智慧气象」**）。这里先把 **粗体**/*斜体* 显式转成 <strong>/<em>，
// 并用私有区字符占位保护代码段不被误转，再交给 marked 解析。
function cjkEmphasis(src) {
  const codes = [];
  src = src.replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => {
    codes.push(m);
    return OPEN + (codes.length - 1) + CLOSE;
  });
  src = src
    .replace(/\*\*(?!\s)([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(?!\s)([^_\n]+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\n])\*(?!\s)([^*\n]+?)\*(?!\*)/gm, "$1<em>$2</em>");
  return src.replace(new RegExp(OPEN + "(\\d+)" + CLOSE, "g"), (_, i) => codes[+i]);
}

// 基础净化：移除脚本/内联事件/危险协议，防止 v-html XSS（内容来自智能体，仍做兜底）
function sanitize(html) {
  return html
    .replace(/<\s*(script|style|iframe)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "$1=$2#$2");
}

// 渲染 Markdown 为安全 HTML。空内容返回空串。
export function renderMarkdown(text) {
  if (!text) return "";
  return sanitize(marked.parse(cjkEmphasis(text)));
}

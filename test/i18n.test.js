import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { messages, setLanguage, getLanguage, t } from "../i18n.js";

test("both locales cover every static and dynamic translation with identical placeholders", async () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ru).sort());
  for (const key of Object.keys(messages.en)) {
    assert.deepEqual([...messages.en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...messages.ru[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key);
  }
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const match of html.matchAll(/data-i18n(?:-aria|-alt)?="([^"]+)"/g)) assert.ok(messages.en[match[1]], match[1]);
});
test("English is the default and Russian preserves the supplied philosophy", () => {
  setLanguage("en", { doc: null, win: null });
  assert.equal(getLanguage(), "en"); assert.equal(t("heroLine1"), "One coin.");
  setLanguage("ru", { doc: null, win: null });
  assert.match(t("philosophy1"), /свободы владения/);
  assert.match(t("philosophy2"), /0,000001 PIH/);
  assert.match(t("philosophy5"), /не обещает доходности/);
  setLanguage("en", { doc: null, win: null });
});
test("a browser without storage can still switch language, metadata, and accessibility labels", () => {
  const text = { dataset: { i18n: "connectWallet" } }, label = { dataset: { i18nAria: "language" }, setAttribute(k, v) { this[k] = v; } };
  const button = { dataset: { language: "ru" }, setAttribute(k, v) { this[k] = v; } };
  const doc = { documentElement: {}, querySelector() { return null; }, querySelectorAll(query) { return { "[data-i18n]": [text], "[data-i18n-aria]": [label], "[data-language]": [button] }[query] || []; } };
  let event;
  const win = { localStorage: { setItem() { throw new Error("disabled"); } }, Event: class { constructor(type) { this.type = type; } }, dispatchEvent(value) { event = value.type; } };
  setLanguage("ru", { doc, win });
  assert.equal(doc.documentElement.lang, "ru"); assert.equal(button["aria-pressed"], "true");
  assert.equal(text.textContent, "Подключить кошелёк"); assert.equal(label["aria-label"], "Язык");
  assert.equal(event, "pih-language-change");
  setLanguage("en", { doc: null, win: null });
});

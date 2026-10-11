// Unit tests for the creative pipeline. Run with: npm run test:unit
//
// These import the TypeScript modules directly; Node strips the types. Only
// pure modules are covered here (no database, no network). Route behaviour and
// persistence are covered by the Playwright suite in scripts/e2e.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseBrief, FORMATS } from "./brief.ts";
import { enforceDistinctStrategies } from "./concepts.ts";
import { planAssets } from "./assets.ts";
import { composeDesign } from "./composition.ts";
import { parseDesignDocument, findElement, replaceElement, countElements } from "./document.ts";
import { layoutDocument, resolveFrame, wrapText } from "./layout.ts";
import { renderDocumentToSvg, escapeXml } from "./render.ts";
import { runDeterministicChecks, blocksExport } from "./validator.ts";
import { applyOperations, parseOperations } from "./revise.ts";
import { retrieveReferences, BUILTIN_REFERENCES } from "./references.ts";
import { parseCritique } from "./critique.ts";
import { mockTextProvider } from "../ai/mock.ts";
import { aiCapabilities } from "../ai/provider.ts";

// ------------------------------------------------------------------ fixtures

const BRIEF = parseBrief(
  {
    projectType: "poster",
    outputFormat: "print-poster",
    subject: "Midnight Jazz",
    message: "A late night jazz session at a neighbourhood roastery.",
    objective: "drive attendance",
    audience: "local music fans",
    tone: ["warm", "intimate"],
    aesthetic: ["retro print"],
    requiredText: {
      headline: "MIDNIGHT JAZZ",
      subheadline: "Live at The Roastery",
      callToAction: "Tickets at the door",
      details: ["Friday 9pm"],
    },
    missingInformation: [],
    clarifyingQuestions: [],
  },
  "midnight jazz",
);

const CONCEPT = {
  id: "1-quiet-authority",
  title: "Quiet Authority",
  rationale: "r",
  metaphor: "m",
  compositionStrategy: "asymmetric-grid",
  imageTreatment: "duotone photograph",
  typographyDirection: "large grotesk headline",
  colorStrategy: "warm neutral with one accent",
  materialStrategy: "print grain",
  suggestedReferenceTags: ["asymmetric-grid", "poster"],
  assetRequirements: [
    { type: "hero-image", role: "hero", description: "A trumpet lit from one side" },
    { type: "typography", role: "headline", description: "Primary headline setting" },
  ],
  avoid: ["drop shadows"],
  objectiveFit: "fit",
};

function buildDocument() {
  const plan = planAssets({ brief: BRIEF, concept: CONCEPT });
  return composeDesign({ brief: BRIEF, concept: CONCEPT, assets: plan.assets });
}

// --------------------------------------------------------------------- brief

test("parseBrief takes dimensions from the format table, not the model", () => {
  const brief = parseBrief(
    { outputFormat: "social-story", dimensions: { width: 10, height: 10 }, requiredText: { headline: "HI" } },
    "fallback",
  );
  assert.equal(brief.dimensions.width, FORMATS["social-story"].width);
  assert.equal(brief.dimensions.height, FORMATS["social-story"].height);
});

test("parseBrief survives entirely junk input", () => {
  const brief = parseBrief(null, "a poster for a bake sale");
  assert.equal(brief.projectType, "poster");
  assert.ok(brief.requiredText.headline.length > 0);
  assert.equal(brief.clarifyingQuestions.length, 0);
});

test("parseBrief caps clarifying questions at two", () => {
  const brief = parseBrief({ clarifyingQuestions: ["a", "b", "c", "d"], requiredText: { headline: "X" } }, "x");
  assert.equal(brief.clarifyingQuestions.length, 2);
});

// ------------------------------------------------------------------ concepts

test("duplicate composition strategies are reassigned, not accepted", () => {
  const concepts = [
    { id: "a", compositionStrategy: "centred-stack" },
    { id: "b", compositionStrategy: "centred-stack" },
    { id: "c", compositionStrategy: "centred-stack" },
  ];
  const adjusted = enforceDistinctStrategies(concepts);
  const strategies = new Set(concepts.map((c) => c.compositionStrategy));
  assert.equal(strategies.size, 3, "all three strategies must differ");
  assert.equal(adjusted.length, 2, "both corrections are reported");
});

// -------------------------------------------------------------------- assets

test("image assets are marked unavailable when no generator is configured", () => {
  const plan = planAssets({ brief: BRIEF, concept: CONCEPT });
  const hero = plan.assets.find((asset) => asset.type === "hero-image");
  assert.equal(aiCapabilities().imageGeneration.available, false);
  assert.equal(hero.status, "unavailable");
  assert.ok(hero.note.length > 0, "must explain why");
  assert.equal(plan.blocked.length, 1);
});

test("typography is produced deterministically, never generated", () => {
  const plan = planAssets({ brief: BRIEF, concept: CONCEPT });
  const type = plan.assets.find((asset) => asset.type === "typography");
  assert.equal(type.source, "procedural");
  assert.equal(type.status, "ready");
  assert.equal(type.cleared, true);
});

// ------------------------------------------------------------------ document

test("composed documents pass their own schema validation", () => {
  const result = parseDesignDocument(buildDocument());
  assert.equal(result.ok, true, JSON.stringify(result.issues ?? []));
});

test("duplicate element ids are rejected with a path", () => {
  const document = buildDocument();
  document.elements.push({ ...document.elements[document.elements.length - 1] });
  const result = parseDesignDocument(document);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /duplicate element id/.test(issue.message)));
});

test("unsupported element types are rejected, not dropped", () => {
  const document = buildDocument();
  document.elements.push({ id: "weird", type: "video", frame: { anchor: "top-left", x: 0, y: 0, width: 1, height: 1 } });
  const result = parseDesignDocument(document);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /unsupported element type/.test(issue.message)));
});

test("replaceElement leaves every other element identical", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const before = JSON.parse(JSON.stringify(document.elements));
  const { document: next, changed } = replaceElement(document, "headline", (element) => ({
    ...element,
    opacity: 0.5,
  }));

  assert.equal(changed, true);
  assert.equal(findElement(next, "headline").opacity, 0.5);
  for (const original of before) {
    if (original.id === "headline") continue;
    assert.deepEqual(findElement(next, original.id), original, `${original.id} must be untouched`);
  }
});

// -------------------------------------------------------------------- layout

test("frames resolve relative to the anchored edge", () => {
  const parent = { x: 0, y: 0, width: 1000, height: 1000 };
  const topLeft = resolveFrame({ anchor: "top-left", x: 0.1, y: 0.1, width: 0.5, height: 0.2 }, parent);
  assert.deepEqual(topLeft, { x: 100, y: 100, width: 500, height: 200 });

  const bottomRight = resolveFrame({ anchor: "bottom-right", x: 0.1, y: 0.1, width: 0.5, height: 0.2 }, parent);
  assert.equal(bottomRight.x + bottomRight.width, 900);
  assert.equal(bottomRight.y + bottomRight.height, 900);
});

test("layout is resolution independent", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const small = layoutDocument(document, 540);
  const large = layoutDocument(document, 2160);
  const ratio = large.canvas.width / small.canvas.width;

  small.nodes.forEach((node, index) => {
    const other = large.nodes[index];
    assert.ok(
      Math.abs(other.box.x - node.box.x * ratio) < 0.01,
      `${node.element.id} x must scale exactly`,
    );
  });
});

test("explicit newlines are hard breaks when wrapping", () => {
  const element = {
    text: "ONE\nTWO",
    transform: "none",
    role: "heading",
    weight: 700,
    letterSpacing: 0,
  };
  assert.deepEqual(wrapText(element, 50, 10_000), ["ONE", "TWO"]);
});

// -------------------------------------------------------------------- render

test("renders deterministic SVG with the right canvas size", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const first = renderDocumentToSvg(document);
  const second = renderDocumentToSvg(document);

  assert.equal(first.svg, second.svg, "rendering must be deterministic");
  assert.match(first.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal(first.width, BRIEF.dimensions.width);
  assert.equal(first.height, BRIEF.dimensions.height);
});

test("required copy actually reaches the SVG", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const { svg } = renderDocumentToSvg(document);
  assert.ok(svg.includes("MIDNIGHT JAZZ"), "headline must be rendered");
  assert.ok(svg.includes("Live at The Roastery"), "subheadline must be rendered");
});

test("escapes markup in text so a document cannot inject script", () => {
  assert.equal(escapeXml(`<script>&"'`), "&lt;script&gt;&amp;&quot;&apos;");

  const document = parseDesignDocument(buildDocument()).value;
  const injected = replaceElement(document, "headline", (element) => ({
    ...element,
    text: '</text><script>alert(1)</script>',
  })).document;

  const { svg } = renderDocumentToSvg(injected);
  // The headline is uppercased by its transform, so compare case-insensitively.
  assert.ok(!/<script>/i.test(svg), "must not emit a script tag");
  assert.ok(!/<\/text><\/text>/i.test(svg), "must not allow breaking out of <text>");
  assert.ok(/&lt;script&gt;/i.test(svg), "the angle brackets must be escaped");
});

test("unresolved images warn instead of rendering nothing", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const { warnings, svg } = renderDocumentToSvg(document);
  assert.ok(warnings.length >= 1, "a placeholder image must warn");
  assert.ok(svg.includes("stroke-dasharray"), "placeholder outline is drawn");
});

test("transparent export omits the background", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const opaque = renderDocumentToSvg(document);
  const clear = renderDocumentToSvg(document, { transparent: true });
  assert.ok(opaque.svg.includes(document.canvas.background));
  assert.ok(clear.svg.length < opaque.svg.length);
});

// ----------------------------------------------------------------- validator

test("missing required copy is a critical failure", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const stripped = replaceElement(document, "headline", (element) => ({ ...element, text: "SOMETHING ELSE" })).document;

  const report = runDeterministicChecks(stripped, { brief: BRIEF });
  const check = report.checks.find((entry) => entry.id === "required-text");
  assert.equal(check.status, "fail");
  assert.equal(check.critical, true);
  assert.ok(blocksExport(report).length > 0, "export must be blocked");
});

test("a clean document passes required text and dimensions", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const report = runDeterministicChecks(document, { brief: BRIEF });
  assert.equal(report.checks.find((entry) => entry.id === "required-text").status, "pass");
  assert.equal(report.checks.find((entry) => entry.id === "dimensions").status, "pass");
});

test("uncleared third-party assets block export", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const report = runDeterministicChecks(document, { brief: BRIEF });
  const licensing = report.checks.find((entry) => entry.id === "licensing");
  // The hero image is planned as "generated" and is not cleared.
  assert.equal(licensing.status, "fail");
  assert.ok(blocksExport(report).some((entry) => entry.id === "licensing"));
});

test("text overflow is detected", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const squashed = replaceElement(document, "headline", (element) => ({
    ...element,
    frame: { ...element.frame, height: 0.001 },
  })).document;

  const report = runDeterministicChecks(squashed, { brief: BRIEF });
  assert.equal(report.checks.find((entry) => entry.id === "text-overflow").status, "fail");
});

test("critical failures are not averaged away", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const broken = replaceElement(document, "headline", (element) => ({ ...element, text: "NOPE" })).document;
  const report = runDeterministicChecks(broken, { brief: BRIEF });
  // Many checks still pass, but status is driven by the failures.
  assert.ok(report.checks.filter((entry) => entry.status === "pass").length > 3);
  assert.equal(report.status, "fail");
});

// -------------------------------------------------------------------- revise

test("targeted revision changes only the named element", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const before = JSON.parse(JSON.stringify(document));

  const result = applyOperations(document, [
    { op: "setTextStyle", target: "headline", property: "weight", value: 300 },
  ]);

  assert.equal(result.applied.length, 1);
  assert.equal(findElement(result.document, "headline").weight, 300);
  assert.deepEqual(result.document.palette, before.palette, "palette untouched");
  assert.deepEqual(result.document.canvas, before.canvas, "canvas untouched");
  assert.equal(countElements(result.document), countElements(before));

  for (const element of before.elements) {
    if (element.id === "headline") continue;
    assert.deepEqual(findElement(result.document, element.id), element);
  }
});

test("required copy cannot be rewritten by a revision", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const result = applyOperations(document, [
    { op: "setText", target: "headline", property: null, value: "SOMETHING ELSE" },
  ]);

  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /required by the brief/);
  assert.equal(findElement(result.document, "headline").text, "MIDNIGHT JAZZ");
});

test("invalid operation values are rejected with a reason", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const result = applyOperations(document, [
    { op: "setColor", target: "accent", property: null, value: "teal" },
    { op: "setOpacity", target: "headline", property: null, value: 7 },
    { op: "setTextStyle", target: "nope", property: "weight", value: 400 },
  ]);

  assert.equal(result.applied.length, 1, "opacity clamps to 1 and applies");
  assert.equal(result.rejected.length, 2);
  assert.match(result.rejected.find((r) => r.target === "accent").reason, /#RRGGBB/);
  assert.match(result.rejected.find((r) => r.target === "nope").reason, /no element/);
});

test("palette revisions keep the canvas background in step", () => {
  const document = parseDesignDocument(buildDocument()).value;
  const result = applyOperations(document, [
    { op: "setColor", target: "background", property: null, value: "#101010" },
  ]);
  assert.equal(result.document.palette.background, "#101010");
  assert.equal(result.document.canvas.background, "#101010");
});

test("parseOperations drops malformed entries", () => {
  const operations = parseOperations({
    operations: [
      { op: "setOpacity", target: "headline", value: 0.5 },
      { op: "deleteEverything", target: "headline" },
      { target: "headline" },
      "nonsense",
    ],
  });
  assert.equal(operations.length, 1);
  assert.equal(operations[0].op, "setOpacity");
});

// ---------------------------------------------------------------- references

test("retrieval prefers references from different categories", () => {
  const retrieved = retrieveReferences({ brief: BRIEF, concept: CONCEPT, limit: 3 });
  assert.ok(retrieved.length > 0);
  const categories = retrieved.map((entry) => entry.reference.category);
  assert.equal(new Set(categories).size, categories.length, "no category repeats");
});

test("every seeded reference is inspiration-only and carries a licence", () => {
  for (const reference of BUILTIN_REFERENCES) {
    assert.equal(reference.usage, "inspiration-only");
    assert.ok(reference.license.length > 0);
    assert.ok(reference.notes.avoid.length > 0, "must say what not to copy");
  }
});

// ------------------------------------------------------------------ critique

test("critique is always labelled as document-based, never as having seen it", () => {
  const evaluation = parseCritique({ scores: { composition: 8, typography: 7 } }, "m", "p");
  assert.equal(evaluation.available, true);
  assert.equal(evaluation.basis, "design-document");
  assert.equal(evaluation.averageScore, 7.5);
});

test("vision is reported unavailable rather than faked", () => {
  const capabilities = aiCapabilities();
  assert.equal(capabilities.vision.available, false);
  assert.ok(capabilities.vision.reason.length > 0);
});

// ---------------------------------------------------------------- mock provider

test("the mock provider is deterministic and self-identifying", async () => {
  const request = { scope: "concepts", system: "s", prompt: 'x """\nmidnight jazz\n"""', schema: {} };
  const first = await mockTextProvider.generateJson(request);
  const second = await mockTextProvider.generateJson(request);

  assert.deepEqual(first.data, second.data);
  assert.equal(first.provider, "mock");
  assert.equal(first.model, "mock-deterministic-1");
  assert.equal(first.data.concepts.length, 3);
});

test("mock revision responds to the actual request wording", async () => {
  const build = (prompt) =>
    mockTextProvider.generateJson({ scope: "revision", system: "s", prompt, schema: {} });

  const typography = await build('"""\nmake the typography more expressive\n"""');
  const colour = await build('"""\nchange the accent colour\n"""');

  assert.equal(typography.data.operations[0].op, "setTextStyle");
  assert.equal(colour.data.operations[0].op, "setColor");
});

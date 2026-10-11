// End-to-end pipeline integration test.
//
// Runs one sample brief through every stage in order, with the deterministic
// mock provider standing in for the language model and no database or HTTP
// involved. This is the test that proves the stages actually compose: each
// one consumes the previous stage's real output rather than a fixture shaped
// to fit.
//
// Route behaviour, authorisation and persistence are covered separately by
// scripts/e2e/api.spec.ts.
import assert from "node:assert/strict";
import { test } from "node:test";

import { mockTextProvider } from "../ai/mock.ts";
import { interpretBrief } from "./brief.ts";
import { generateConcepts } from "./concepts.ts";
import { retrieveReferences, principlesFrom } from "./references.ts";
import { planAssets } from "./assets.ts";
import { composeDesign } from "./composition.ts";
import { parseDesignDocument, findElement } from "./document.ts";
import { renderDocumentToSvg } from "./render.ts";
import { runDeterministicChecks, blocksExport } from "./validator.ts";
import { planRevision, applyOperations } from "./revise.ts";
import { evaluateCreative } from "./critique.ts";

const SAMPLE_BRIEF = `A poster for a late night jazz session at a neighbourhood roastery.
Warm, intimate, a bit retro. Needs to feel handmade rather than corporate.`;

/**
 * Concatenates the rendered text content. Long copy is wrapped across one
 * tspan per line, so the source string is not contiguous in the markup.
 */
function svgText(svg) {
  return [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)]
    .map((match) => match[1])
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

test("a brief travels the whole pipeline and produces a valid export", async (t) => {
  // --- Stage A: brief ------------------------------------------------------
  const { brief, model, provider } = await interpretBrief(mockTextProvider, {
    briefText: SAMPLE_BRIEF,
    formatHint: "print-poster",
  });

  assert.equal(provider, "mock");
  assert.equal(model, "mock-deterministic-1");
  assert.equal(brief.outputFormat, "print-poster");
  assert.equal(brief.dimensions.width, 1080);
  assert.equal(brief.dimensions.height, 1350);
  assert.ok(brief.requiredText.headline.length > 0);

  // --- Stage B: concepts ---------------------------------------------------
  const conceptResult = await generateConcepts(mockTextProvider, brief);
  assert.equal(conceptResult.concepts.length, 3);

  const strategies = conceptResult.concepts.map((concept) => concept.compositionStrategy);
  assert.equal(new Set(strategies).size, 3, "the three concepts must be structurally different");
  for (const concept of conceptResult.concepts) {
    assert.ok(concept.id.length > 0);
    assert.ok(concept.rationale.length > 0);
    assert.ok(concept.metaphor.length > 0);
  }

  // --- Stage C: references -------------------------------------------------
  const selected = conceptResult.concepts[0];
  const references = retrieveReferences({ brief, concept: selected });
  assert.ok(references.length > 0, "at least one reference must match");

  const principles = principlesFrom(references);
  for (const entry of principles) {
    assert.ok(entry.principle.length > 0, "each reference records what it contributes");
    assert.equal(entry.usage, "inspiration-only");
  }

  // --- Stage D: asset plan -------------------------------------------------
  const plan = planAssets({ brief, concept: selected });
  assert.ok(plan.assets.length > 0);
  for (const asset of plan.assets) {
    assert.ok(["planned", "ready", "unavailable"].includes(asset.status));
    if (asset.status === "unavailable") assert.ok(asset.note.length > 0, "must say why");
  }

  // --- Stage E: composition ------------------------------------------------
  const composed = composeDesign({ brief, concept: selected, assets: plan.assets });
  const validated = parseDesignDocument(composed);
  assert.equal(validated.ok, true, JSON.stringify(validated.issues ?? []));

  const v1 = validated.value;
  assert.equal(v1.meta.conceptId, selected.id);
  assert.equal(v1.canvas.width, brief.dimensions.width);

  // --- Stage F: render -----------------------------------------------------
  const render = renderDocumentToSvg(v1);
  assert.match(render.svg, /<svg /);
  assert.equal(render.unsupported.length, 0, "no element may be silently unrenderable");

  const rendered = svgText(render.svg);
  for (const word of brief.requiredText.headline.split(/\s+/)) {
    assert.ok(rendered.includes(word), `headline word "${word}" must reach the SVG`);
  }

  const scaled = renderDocumentToSvg(v1, { width: 540 });
  assert.equal(scaled.width, 540);
  assert.equal(Math.round(scaled.height), Math.round((540 / v1.canvas.width) * v1.canvas.height));

  // --- Stage G: validation -------------------------------------------------
  const report = runDeterministicChecks(v1, { brief });
  assert.equal(report.checks.find((check) => check.id === "required-text").status, "pass");
  assert.equal(report.checks.find((check) => check.id === "dimensions").status, "pass");
  assert.equal(report.checks.find((check) => check.id === "text-overflow").status, "pass");
  assert.equal(report.checks.find((check) => check.id === "renderer-support").status, "pass");

  const creative = await evaluateCreative(mockTextProvider, { document: v1, concept: selected });
  assert.equal(creative.available, true);
  assert.equal(creative.basis, "design-document", "must not claim to have seen the render");

  // --- Stage H: targeted revision -----------------------------------------
  const revisionPlan = await planRevision(mockTextProvider, {
    document: v1,
    request: "make the typography more expressive",
  });
  assert.ok(revisionPlan.operations.length > 0);

  const revised = applyOperations(v1, revisionPlan.operations);
  assert.ok(revised.applied.length > 0, "the request must land on something");

  const v2 = parseDesignDocument(revised.document);
  assert.equal(v2.ok, true, JSON.stringify(v2.issues ?? []));

  // The whole point of a targeted revision: everything else is preserved.
  assert.deepEqual(v2.value.palette, v1.palette, "palette preserved");
  assert.equal(v2.value.meta.conceptId, v1.meta.conceptId, "concept preserved");
  assert.equal(
    findElement(v2.value, "headline").text,
    findElement(v1, "headline").text,
    "required copy preserved",
  );

  const touched = new Set(revised.applied.map((change) => change.target));
  for (const element of v1.elements) {
    if (touched.has(element.id)) continue;
    assert.deepEqual(
      findElement(v2.value, element.id),
      element,
      `${element.id} must be untouched by an unrelated revision`,
    );
  }

  // --- Stage I: export -----------------------------------------------------
  // This concept needs typography only, so nothing is unresolved and the
  // export is allowed.
  const finalReport = runDeterministicChecks(v2.value, { brief });
  assert.deepEqual(
    blocksExport(finalReport).map((check) => check.id),
    [],
    `export must not be blocked: ${finalReport.failed.map((c) => `${c.id}: ${c.detail}`).join(" | ")}`,
  );

  // A concept that does need generated artwork must block instead, because
  // no image provider is configured. Export honesty is the point of the gate.
  const withHero = conceptResult.concepts.find((concept) =>
    concept.assetRequirements.some((requirement) => requirement.type === "hero-image"),
  );
  assert.ok(withHero, "the mock must offer at least one image-led concept");

  const heroPlan = planAssets({ brief, concept: withHero });
  const heroDocument = parseDesignDocument(
    composeDesign({ brief, concept: withHero, assets: heroPlan.assets }),
  );
  assert.equal(heroDocument.ok, true, JSON.stringify(heroDocument.issues ?? []));

  const heroBlocking = blocksExport(runDeterministicChecks(heroDocument.value, { brief }));
  assert.ok(
    heroBlocking.some((check) => check.id === "assets-resolved" || check.id === "licensing"),
    "an unresolved generated asset must block export",
  );

  const exported = renderDocumentToSvg(v2.value).svg;
  assert.ok(exported.length > 500);
  assert.ok(exported.startsWith("<svg"));
  assert.ok(exported.endsWith("</svg>"));

  t.diagnostic(`pipeline produced ${exported.length} bytes of SVG across 2 versions`);
});

test("a text-only concept produces an immediately exportable design", async () => {
  const { brief } = await interpretBrief(mockTextProvider, {
    briefText: "A typographic poster announcing a lecture series. No photography.",
    formatHint: "print-poster",
  });

  // A concept whose only asset need is typography has nothing unresolved.
  const concept = {
    id: "1-type-only",
    title: "Type Only",
    rationale: "r",
    metaphor: "m",
    compositionStrategy: "typographic-stack",
    imageTreatment: "no imagery",
    typographyDirection: "large grotesk",
    colorStrategy: "paper and ink",
    materialStrategy: "flat, no texture",
    suggestedReferenceTags: ["typographic-stack"],
    assetRequirements: [{ type: "typography", role: "headline", description: "Headline setting" }],
    avoid: [],
    objectiveFit: "fit",
  };

  const plan = planAssets({ brief, concept });
  assert.equal(plan.blocked.length, 0, "nothing should be unproducible");

  const document = parseDesignDocument(composeDesign({ brief, concept, assets: plan.assets }));
  assert.equal(document.ok, true, JSON.stringify(document.issues ?? []));

  const report = runDeterministicChecks(document.value, { brief });
  assert.deepEqual(
    blocksExport(report).map((check) => check.id),
    [],
    `export must not be blocked: ${report.failed.map((c) => `${c.id}: ${c.detail}`).join(" | ")}`,
  );
  assert.ok(["pass", "warn"].includes(report.status));
});

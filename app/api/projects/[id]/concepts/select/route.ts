import { logDatabaseFailure } from "@/lib/db";
import { rateLimited } from "@/lib/rate-limit";
import { planAssets } from "@/lib/pipeline/assets";
import { composeDesign } from "@/lib/pipeline/composition";
import { parseDesignDocument } from "@/lib/pipeline/document";
import { principlesFrom, retrieveReferences } from "@/lib/pipeline/references";
import {
  createVersion,
  getBrief,
  listConcepts,
  saveAssets,
  updateProject,
} from "@/lib/pipeline/store";
import { fail, ok, readJson, requireProject } from "@/lib/pipeline/http";
import { text } from "@/lib/pipeline/validate";

type RouteProps = { params: Promise<{ id: string }> };
type Body = { conceptId?: unknown };

const MAX_BODY_BYTES = 4 * 1024;

/**
 * Selecting a concept runs the deterministic half of the pipeline in one go:
 * reference retrieval, asset planning, composition, and version 1 of the
 * design document. None of it needs a model, so it either all succeeds or
 * fails for a reason the caller can act on.
 */
export async function POST(request: Request, { params }: RouteProps) {
  const limited = rateLimited(request, "pipeline-select", { perClientPerMinute: 20, globalPerHour: 600 });
  if (limited) return limited;

  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;
  const { project } = resolved.context;

  const parsed = await readJson<Body>(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const conceptId = text(parsed.value.conceptId, 80);
  if (!conceptId) return fail(400, "invalid_concept_id");

  let brief;
  let concepts;
  try {
    [brief, concepts] = await Promise.all([getBrief(project.id), listConcepts(project.id)]);
  } catch {
    logDatabaseFailure("load project for selection");
    return fail(503, "database_unavailable");
  }

  if (!brief) return fail(409, "brief_required");
  const concept = concepts.find((entry) => entry.id === conceptId);
  if (!concept) return fail(404, "concept_not_found");

  const references = retrieveReferences({ brief, concept });
  const plan = planAssets({ brief, concept });
  const document = composeDesign({ brief, concept, assets: plan.assets });

  // The planner's own output goes through the same validation untrusted input
  // would, so a bug here surfaces as a 500 with detail rather than a bad
  // document being persisted.
  const validated = parseDesignDocument(document);
  if (!validated.ok) {
    return fail(500, "composition_invalid", { issues: validated.issues });
  }

  try {
    await saveAssets(project.id, concept.id, plan.assets);
    const version = await createVersion(project.id, {
      document: validated.value,
      summary: `Composed from concept "${concept.title}"`,
      changes: [`concept:${concept.id}`, `strategy:${concept.compositionStrategy}`],
      parentVersion: null,
    });
    await updateProject(project.id, { status: "designing", selectedConceptId: concept.id });

    return ok({
      conceptId: concept.id,
      version,
      document: validated.value,
      assets: plan.assets,
      blockedAssets: plan.blocked,
      references: references.map((entry) => ({
        id: entry.reference.id,
        title: entry.reference.title,
        category: entry.reference.category,
        score: entry.score,
        matched: entry.matched,
        usage: entry.reference.usage,
        license: entry.reference.license,
      })),
      principles: principlesFrom(references),
    });
  } catch {
    logDatabaseFailure("save selection");
    return fail(503, "database_unavailable");
  }
}

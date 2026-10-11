import { logDatabaseFailure } from "@/lib/db";
import { BUILTIN_REFERENCES, principlesFrom, retrieveReferences } from "@/lib/pipeline/references";
import { getBrief, listConcepts } from "@/lib/pipeline/store";
import { fail, ok, requireProject } from "@/lib/pipeline/http";
import { text } from "@/lib/pipeline/validate";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * References retrieved for a concept. ?conceptId= overrides the selected one.
 *
 * Every record is returned with its licence and usage, because these are
 * inspiration for design decisions and must not be mistaken for assets that
 * can be placed in a published design.
 */
export async function GET(request: Request, { params }: RouteProps) {
  const { id } = await params;
  const resolved = await requireProject(id);
  if (!resolved.ok) return resolved.response;
  const { project } = resolved.context;

  const requested = text(new URL(request.url).searchParams.get("conceptId"), 80);

  let brief;
  let concepts;
  try {
    [brief, concepts] = await Promise.all([getBrief(project.id), listConcepts(project.id)]);
  } catch {
    logDatabaseFailure("load references context");
    return fail(503, "database_unavailable");
  }

  if (!brief) return fail(409, "brief_required");

  const conceptId = requested ?? project.selectedConceptId;
  const concept = concepts.find((entry) => entry.id === conceptId);
  if (!concept) return fail(409, "concept_required");

  const retrieved = retrieveReferences({ brief, concept });

  return ok({
    conceptId: concept.id,
    catalogueSize: BUILTIN_REFERENCES.length,
    references: retrieved.map((entry) => ({ ...entry.reference, score: entry.score, matched: entry.matched })),
    principles: principlesFrom(retrieved),
  });
}

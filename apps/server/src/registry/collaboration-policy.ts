/** Shared write policy for direct edits and accepted proposals; permission is decided centrally. */
import { type CanonicalCreation, CharError, type JSONValue, jcs } from "@char-pub/core";
import type { Principal, Resource } from "../authz/authorize.js";
import { authorize } from "../authz/authorize.js";

function protectedFields(c: CanonicalCreation): JSONValue {
  return {
    authors: c.authors ?? null,
    meta: {
      license: c.meta.license,
      rating: c.meta.rating,
      rights: c.meta.rights,
      content_warnings: c.meta.content_warnings ?? [],
      contribution_policy: c.meta.contribution_policy ?? "signed-in",
    },
    provenance: c.provenance,
    assets: c.assets
      .flatMap((asset) =>
        asset.variants
          .filter((v) => v.license !== undefined || v.rating !== undefined)
          .map((v) => ({
            slot: asset.slot,
            variant: v.id,
            license: v.license ?? null,
            rating: v.rating ?? null,
          })),
      )
      .sort((a, b) => `${a.slot}/${a.variant}`.localeCompare(`${b.slot}/${b.variant}`)),
  } as JSONValue;
}
export function assertCollaborationWrite(
  principal: Principal,
  resource: Extract<Resource, { type: "creation" }>,
  before: CanonicalCreation,
  after: CanonicalCreation,
  allowContributorAppend = false,
  allowAgentAddition = false,
): void {
  if (authorize(principal, "creation.update_settings", resource).allow) return;
  const checked = { ...after, provenance: { ...after.provenance } };
  if (allowContributorAppend) {
    if (before.provenance.contributors === undefined) delete checked.provenance.contributors;
    else checked.provenance.contributors = before.provenance.contributors;
  }
  // A content editor may conservatively declare agent participation, or accept a recorded
  // agent contribution. Only this monotonic boolean addition is excluded from owner-field comparison.
  if (allowAgentAddition && after.provenance.authored_by_agent === true) {
    if (before.provenance.authored_by_agent === undefined)
      delete checked.provenance.authored_by_agent;
    else checked.provenance.authored_by_agent = before.provenance.authored_by_agent;
  }
  if (jcs(protectedFields(before)) !== jcs(protectedFields(checked)))
    throw new CharError({
      code: "collaboration.owner_fields",
      subject: resource.id,
      detail:
        "Only the owner can change attribution, license, rights, rating, content warnings, contribution policy or explicit asset license/rating.",
    });
}

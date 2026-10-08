"use strict";

/*
  Permissions are named after what they let a caller do to a release, not after
  job titles, so the matrix can be read as policy and audited without knowing
  the org chart. A role is only a bundle of these names.
*/

const PERMISSIONS = {
  "ticket:read": ["dev", "approver", "ops", "admin"],
  "ticket:create": ["dev", "ops"],
  "ticket:comment": ["dev", "approver", "ops"],
  "merge:request": ["dev"],
  "merge:perform": ["ops"],
  "deploy:sit": ["dev", "ops"],
  "deploy:uat": ["ops"],
  "deploy:prod": ["ops"],
  // The team layer belongs to the people who wrote the change; an approver who
  // could sign all five would make the chain a formality.
  "approval:grant:team": ["dev"],
  "approval:grant:business": ["approver"],
  "approval:grant:product": ["approver"],
  "approval:grant:architecture": ["approver"],
  "approval:grant:engineering": ["approver"],
  "audit:read": ["approver", "ops", "admin"],
  "key:rotate": ["admin"],
  // Reading which version runs where is not sensitive; reading what a credential
  // is called, and when it expires, is - so they are two names, not one.
  "release:read": ["dev", "approver", "ops", "admin"],
  "secret:read": ["ops", "admin"],
  "user:read": ["admin"],
};

const ROLES = [...new Set(Object.values(PERMISSIONS).flat())];

function allows(role, permission) {
  const holders = PERMISSIONS[permission];
  if (!holders) return false;
  return holders.includes(role);
}

// Every layer of the approval chain is a distinct permission on purpose: one
// "approve" right would make the five-layer chain a formality.
const approvalPermission = (layer) => `approval:grant:${layer}`;

function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((p) => allows(role, p));
}

function missingApprovalsFor(role) {
  return Object.keys(PERMISSIONS)
    .filter((p) => p.startsWith("approval:grant:") && !allows(role, p))
    .map((p) => p.split(":").pop());
}

module.exports = { PERMISSIONS, ROLES, allows, approvalPermission, permissionsFor, missingApprovalsFor };

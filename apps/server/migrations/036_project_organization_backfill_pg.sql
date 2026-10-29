-- Link projects created without an organization to their owner's organization.
-- Only rows with a NULL organization_id change, so running it again changes nothing.

-- Owners who own an organization: their oldest one.
UPDATE projects p
SET organization_id = owned.id
FROM (
    SELECT DISTINCT ON (owner_id) owner_id, id
    FROM organizations
    ORDER BY owner_id, created_at, id
) owned
WHERE p.organization_id IS NULL
  AND p.owner_id = owned.owner_id;

-- Owners who own none but belong to exactly one organization: that one.
UPDATE projects p
SET organization_id = membership.organization_id
FROM (
    SELECT user_id, MIN(organization_id) AS organization_id
    FROM organization_members
    GROUP BY user_id
    HAVING COUNT(DISTINCT organization_id) = 1
) membership
WHERE p.organization_id IS NULL
  AND p.owner_id = membership.user_id;

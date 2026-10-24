---
name: redeploy-bxhealth-epiccarelink-demo
description: "Use when explicitly asked to publish or deploy the BX-Health EpicCare Link demo to its fixed AWS Kubernetes namespace, provision its Route 53 hostname, or deploy with DNS deferred for hosts-file testing."
argument-hint: "Optional --skip-dns or local commit message"
user-invocable: true
disable-model-invocation: true
---

# Redeploy BX-Health EpicCare Link Demo

## Scope and approval

This skill can cause downtime, publish an image, change one DNS record, and
update Kubernetes resources. Invocation is not approval to execute. Start with
read-only checks, present the exact plan and any DNS change, and wait for
explicit approval. If approval is missing, ambiguous, or declined, stop.
Creating or editing this skill never authorizes a deployment.

DNS is provisioned by default. If the user passes `--skip-dns` or explicitly
defers DNS, do not call AWS Route 53 or create, update, or query DNS records.
Keep the Ingress hostname and wildcard TLS configuration; verify the app using
a hosts-file mapping or `curl --resolve`. Never edit the user's hosts file.

Fixed identity:

- Repository: `stephenpayne262/bxhealth-epiccarelink-demo`.
- Package: `bx-health-epic-oidc-demo`.
- Kubernetes context: `ping-dev-aws-us-east-2-oidc`.
- Namespace: `ping-devops-stephenpayne`.
- Deployment, Service, and Ingress: `bxhealth-epiccarelink-demo`.
- Container: `app`, port `3010`.
- Secret: `bxhealth-epiccarelink-demo-secrets`.
- GHCR image: `ghcr.io/stephenpayne262/bxhealth-epiccarelink-demo`.
- Public URL: `https://bxhealth-epiccarelink-demo.ping-devops.com`.
- IngressClass: `nginx-public`; TLS uses the controller's existing
  `*.ping-devops.com` default certificate. Do not set `secretName` or create,
  update, or delete certificates or the shared ingress controller.
- DNS zone: the exact public Route 53 hosted zone `ping-devops.com`.

Never retarget these values silently. A mismatch, ambiguous cluster/controller,
missing zone, or unexpected resource ownership means stop and ask. Always pass
`--context ping-dev-aws-us-east-2-oidc` and
`--namespace ping-devops-stephenpayne` to namespaced kubectl operations. Never
change the global kubectl context.

Only manage this app's Deployment, Service, Ingress, Secret, and the exact
`bxhealth-epiccarelink-demo.ping-devops.com` DNS record. Never modify, delete,
or read secret data from the FHIR/MCP app or any other app. Never delete a
namespace, shared LoadBalancer, IngressClass, TLS certificate, hosted zone, or
registry package. Do not use broad selectors, `delete all`, or apply a whole
directory. The skill does not push the Git branch or dispatch GitHub Actions.

## 1. Read-only preflight

Inspect the current repository instructions, Docker files, manifests, README,
Git branch/remotes/status, staged and unstaged diffs, and untracked filenames.
Confirm the working directory is this repository, `package.json` has the
expected package name, and the origin points to the fixed repository. Review
the exact files proposed for a local commit. Exclude `.env`, `.env.*`,
`infra/.env.k8s`, build output, dependencies, and unrelated changes. Never
read or print environment-file values.

Check Docker Desktop and Buildx availability. Do not start, stop, or recreate
the user's local Compose app during a deploy. The user should finish local
testing first; the app's Docker-only validation command is:

```bash
docker build -f Dockerfile --target check --progress=plain .
```

Inspect only metadata for cluster identity and existing app resources. Verify
the fixed context, namespace, IngressClass, app resource ownership, node
architecture, expected image, and rollout status. Check that the app Secret
exists by name only; never fetch its data. If it is missing, require
`infra/.env.k8s`, and validate required variable names without printing
values. If the Secret already exists, do not modify it in this workflow.

When DNS is not deferred, perform these DNS and TLS checks:

1. Run `aws sts get-caller-identity --query Account --output text` and show
   the account ID in the plan; do not display credentials. Confirm there is
   exactly one public Route 53 hosted zone named `ping-devops.com`.
2. Identify the unique external LoadBalancer DNS name serving IngressClass
   `nginx-public`. If it cannot be identified unambiguously, stop.
3. Inspect the exact app hostname's Route 53 record. If it already points to
   that LoadBalancer, leave it unchanged. If it is missing, propose creating
   only a CNAME for the exact app hostname, TTL 300, targeting that verified
   LoadBalancer DNS name. If it exists with another type or target, stop; do
   not overwrite it.
4. Verify the current FHIR/MCP hostname resolves to the same controller and
   has a valid certificate using normal TLS verification. Do not modify its
   records or Ingress.

When DNS is deferred, skip all AWS identity, Route 53, and DNS-record queries.
Still verify the fixed IngressClass and controller from Kubernetes metadata.
After deployment, obtain the controller's current public addresses and test
HTTPS with the requested hostname using `curl --resolve`; report the hosts-file
mapping without editing `/etc/hosts`.

Check for concurrent deployments or rollouts. If another operation could race,
stop and coordinate.

Do not build, stage, commit, log in, publish, change DNS, apply, delete, or
restart anything during preflight. If authentication is missing, ask the user
to authenticate in their own terminal; never request tokens or passwords in
chat.

Present a plan that names:

1. Current branch and exact local commit files/message; no Git branch push.
2. Docker check and the existing local-test result.
3. ARM64 image tag and GHCR publication.
4. Exact context, namespace, Deployment, Service, Ingress, and Secret.
5. Whether DNS is being provisioned, left unchanged, or explicitly deferred
   for hosts-file testing. Include the exact Route 53 record only when DNS is
   not deferred.
6. Expected short downtime and loss of in-flight in-memory OIDC states.
7. Preservation of the FHIR/MCP app, other resources, shared LoadBalancer,
   wildcard TLS, and existing DNS records.
8. Validation and recovery plan.

Require explicit approval of this exact plan before continuing. A material
scope change requires new approval.

## 2. Commit and Docker validation

After approval, stage only the reviewed files using explicit paths, inspect
`git diff --cached`, and run `git diff --cached --check`. Never use `git add .`
or `git add -A`. Commit locally using the approved message. Do not amend,
reset, force-push, merge, or push the Git branch. Record the full commit SHA and
confirm no uncommitted build-affecting files remain.

Run the Docker check target above. A failure stops before GHCR, DNS, or cluster
changes. Do not fix unapproved problems automatically. Do not use host Node.js
or npm for project execution or validation.

If the app Secret is absent, show the exact Secret name and source filename in
the plan. After approval, create it from the ignored env file without printing
the generated YAML or values:

```bash
chmod 600 infra/.env.k8s
kubectl --context ping-dev-aws-us-east-2-oidc \
  --namespace ping-devops-stephenpayne create secret generic \
  bxhealth-epiccarelink-demo-secrets \
   --from-env-file=infra/.env.k8s --dry-run=client -o yaml \
  | kubectl --context ping-dev-aws-us-east-2-oidc \
      --namespace ping-devops-stephenpayne apply -f -
```

If the Secret already exists, preserve it. Updating an existing Secret is
outside this workflow and needs separate approval.

## 3. Publish an immutable image

Use the full local commit SHA as the tag. The confirmed cluster runs ARM64;
recheck this during preflight and stop if the node architecture differs.
Publish only the immutable commit tag; do not move `latest` or another tag.

```bash
TAG=$(git rev-parse HEAD)
docker buildx build --platform linux/arm64 --target runtime \
  -f Dockerfile \
  -t "ghcr.io/stephenpayne262/bxhealth-epiccarelink-demo:$TAG" --push .
docker buildx imagetools inspect \
  "ghcr.io/stephenpayne262/bxhealth-epiccarelink-demo:$TAG"
```

Record the digest and verify ARM64. The manifest has no imagePullSecret, so
verify anonymous image access. If the package is private, stop; do not change
package visibility or create registry credentials without separate approval.
Deploy the verified digest, not `latest`.

## 4. Apply only this app and provision DNS if missing

Before applying, save the current app Deployment, Service, and Ingress specs
outside the repository with restrictive permissions. Do not save Secret data.
Check all three names are either absent or owned by this exact app; a collision
or different owner requires stopping. Render a temporary manifest outside the
repository, replacing exactly the app image with the verified digest. Verify
the namespace, resource names, image, Service target port, and Ingress host
before applying.

Use server-side dry-run, then apply only the two named manifest files with the
explicit context and namespace. Never delete/recreate existing resources or
apply the whole `infra/k8s/` directory. Preserve the Recreate strategy and one
replica because OIDC flow state is process-local.

If DNS is not deferred and the exact record was missing at preflight, and only
after the approved plan, use Route 53 `CREATE` for that one CNAME. Do not use
`UPSERT`. If the record appears between preflight and creation, stop and inspect
it rather than overwriting it. If the record already matched the verified
LoadBalancer, do not change it. In DNS-deferred mode, do not execute the Route
53 command below.

Use the preflight's exact zone ID and verified LoadBalancer DNS name:

```bash
aws route53 change-resource-record-sets \
   --hosted-zone-id "$ZONE_ID" \
   --change-batch "{\"Changes\":[{\"Action\":\"CREATE\",\"ResourceRecordSet\":{\"Name\":\"bxhealth-epiccarelink-demo.ping-devops.com.\",\"Type\":\"CNAME\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"${LB_DNS%.}.\"}]}}]}"
```

Wait for the bounded rollout, then verify the Service endpoint and Ingress
rule. In normal DNS mode, verify DNS and public HTTPS with certificate
verification enabled. In DNS-deferred mode, test HTTPS using `curl --resolve`
and report the hosts-file mapping. Check `/` and `/health` return HTTP 200.
Never use `curl -k` or edit `/etc/hosts`. If TLS or the rollout fails, stop and
report the exact state; do not loop through deletes or recreates. Request
approval before rollback. If this run created the DNS record, remove only that
exact record during rollback and only with approval.

## 5. Report

On success, report the local commit SHA, image digest, fixed context and
namespace, resources changed, whether the exact DNS CNAME was created, HTTPS
certificate/health results, DNS-deferred hosts-file mapping when applicable,
and confirm the Git branch was not pushed. Do not report secrets. On failure,
report the stage and retain recovery files outside the repository for explicit
recovery.
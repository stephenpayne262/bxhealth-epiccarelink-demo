---
name: redeploy-bxhealth-epiccarelink-demo
description: "Use when explicitly asked to publish or deploy the BX-Health EpicCare Link demo to its fixed AWS Kubernetes namespace, using the cluster's ExternalDNS Ingress annotation or deferring DNS for hosts-file testing."
argument-hint: "Optional --skip-dns or local commit message"
user-invocable: true
disable-model-invocation: true
---

# Redeploy BX-Health EpicCare Link Demo

## Scope and approval

This skill can cause downtime, publish an image, and trigger ExternalDNS to
publish the app hostname. Invocation is not approval to execute. Start with
read-only checks, present the exact plan and DNS behavior, and wait for explicit
approval. If approval is missing, ambiguous, or declined, stop. Creating or
editing this skill never authorizes a deployment.

DNS is published by the cluster's ExternalDNS controller from the app Ingress
annotation; never write Route 53 records directly. If the user passes
`--skip-dns` or explicitly defers DNS, omit that annotation only when the live
Ingress does not already have it. If the live annotation exists, stop: removing
it under the controller's `sync` policy could delete its managed DNS record.
In deferred mode use `curl --resolve`; never edit the user's hosts file.

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
- ExternalDNS annotation:
   `external-dns.alpha.kubernetes.io/hostname: bxhealth-epiccarelink-demo.ping-devops.com`.
- IngressClass: `nginx-public`; TLS uses the controller's existing
  `*.ping-devops.com` default certificate. Do not set `secretName` or create,
  update, or delete certificates or the shared ingress controller.

Never retarget these values silently. A mismatch, ambiguous cluster/controller,
or unexpected resource ownership means stop and ask. Always pass
`--context ping-dev-aws-us-east-2-oidc` and
`--namespace ping-devops-stephenpayne` to namespaced kubectl operations. Never
change the global kubectl context.

Only manage this app's Deployment, Service, Ingress, and Secret. ExternalDNS
publishes only the hostname declared on this app's Ingress. Never modify,
delete, or read secret data from the FHIR/MCP app or any other app. Never delete a
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

Verify the fixed `nginx-public` IngressClass and inspect the ExternalDNS
Deployment's arguments. DNS-enabled runs require `--source=ingress`,
`--provider=aws`, `--policy=sync`, `--registry=txt`, and
`--txt-owner-id=ping-dev-aws-us-east-2`. If any expected setting is missing or
differs, stop and ask; do not change the shared controller configuration.
Confirm the app hostname is not already declared by another Ingress or Service.

Never call AWS Route 53 APIs or edit DNS records directly. Applying this app's
Ingress hostname annotation is the DNS change: the cluster's ExternalDNS
controller publishes the host through its existing AWS identity and TXT-owner
policy. Verify the FHIR/MCP hostname and wildcard certificate using normal TLS
verification, without modifying its Ingress or DNS.

When DNS is deferred, do not add or remove an ExternalDNS annotation and do not
query DNS. Verify the IngressClass and controller from Kubernetes metadata. Use
`curl --resolve` with the requested hostname and current controller address;
report the temporary hosts-file mapping without editing `/etc/hosts`.

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
5. Whether the app Ingress ExternalDNS annotation will publish DNS or DNS is
  explicitly deferred for hosts-file testing.
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

## 4. Apply only this app and let ExternalDNS publish the hostname

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

In DNS-enabled mode, apply the app Ingress with the exact ExternalDNS hostname
annotation. This is the DNS change; let the cluster controller publish it.
Never use AWS CLI or another API to write Route 53 records directly. In
DNS-deferred mode, render a temporary Ingress without the ExternalDNS annotation
only if the live Ingress does not already have that annotation; otherwise stop
because removing it can delete a managed record.

Wait for the bounded rollout and verify the Service endpoint and Ingress rule.
In DNS-enabled mode, allow ExternalDNS to publish the record, then verify
hostname resolution and public HTTPS with certificate verification enabled.
In DNS-deferred mode, test HTTPS using `curl --resolve` and report the
hosts-file mapping. Check `/` and `/health` return HTTP 200. Never use `curl -k`
or edit `/etc/hosts`. If DNS, TLS, or rollout fails, stop and report the exact
state; do not loop through deletes or recreates. Request approval before
rollback. Removing the ExternalDNS annotation may delete its managed record,
so include that effect in any rollback plan.

## 5. Report

On success, report the local commit SHA, image digest, fixed context and
namespace, resources changed, ExternalDNS annotation state, HTTPS
certificate/health results, DNS-deferred hosts-file mapping when applicable,
and confirm the Git branch was not pushed. Do not report secrets. On failure,
report the stage and retain recovery files outside the repository for explicit
recovery.
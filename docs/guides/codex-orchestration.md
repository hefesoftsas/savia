# Codex orchestration

The project does not set a default coordinator model, so Codex Desktop can use
the user's normal default and the model selector remains available per task.
The project `.codex/config.toml` sets medium reasoning effort, enables multi-agent
tools, and defaults delegated work to GPT-6 Luna with high reasoning through the default, worker, and explorer
roles in `.codex/agents/luna.toml`. The role configuration supports Codex CLI
0.158.0 and later. `agents.max_threads = 2` bounds agent threads in that runtime;
`AGENTS.md` also limits the workflow to two concurrent workers in other runtimes.

## Starting a task

Open a new Codex task in this project, or run `codex` from the repository root.
Choose the coordinator model and medium reasoning in the model selector: an explicit session or
CLI model override can take precedence over project defaults. Existing tasks
may retain their selected model. Project configuration requires a trusted project.

Describe the desired outcome and acceptance criteria. Astra can delegate
independent parts to Luna and review their combined results. Workers receive
bounded assignments and report blockers or completion; the coordinator avoids
continuous status polling. Small changes can stay entirely with Astra.

## Local full-access permissions

Permissions are intentionally inherited from the user's local Codex configuration.
On the machine where this setup was installed, `~/.codex/config.toml` already had:

```toml
sandbox_mode = "danger-full-access"
approval_policy = "never"
```

These settings allow filesystem and network access without sandbox restrictions
and disable command approval prompts. They are machine settings, not permissions
granted by this repository. App permissions and administrator policies can still
affect execution. Moving or cloning the repository does not grant full access.

## Checking and changing the setup

Run `codex doctor --summary` from the repository to check the local installation
and configuration. A runtime pilot should confirm the
selected parent and worker models, a bounded worker report, and the final review;
configuration parsing alone does not prove model availability or delegation.

## Setting up another machine

1. Check out or pull the Savia repository, including `.codex/config.toml`,
   `.codex/agents/luna.toml`, and `AGENTS.md`.
2. Install/update Codex CLI to 0.158.0 or later, then restart Codex Desktop.
3. Open the repository in Desktop and trust it so project `.codex/` settings load.
4. Keep your own model choice in the Desktop selector; the project sets medium
   reasoning but does not force the coordinator model.
5. If you want full local access, set this only in that machine's
   `~/.codex/config.toml`:

   ```toml
   sandbox_mode = "danger-full-access"
   approval_policy = "never"
   ```

6. Start a new task and ask the coordinator to delegate one bounded task. Confirm
   the agent activity shows a child using GPT-6 Luna, then review the coordinator's
   summary. Availability depends on that machine's Codex account and policy.

Full access and disabled approval prompts apply to all projects on that machine.
Do not copy them into the shared repository config unless every collaborator
intentionally wants those machine-wide permissions.

Change model defaults in `.codex/config.toml` and workflow instructions in
`AGENTS.md`. Remove those project defaults and the orchestration section to
restore inherited behavior. Local permission settings remain independent.

Reference: [OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

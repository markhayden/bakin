import { render, Box } from "ink";
import { useState, type ReactElement } from "react";
import {
  MultiSelect,
  createMultiSelectState,
  type MultiSelectItem,
  type MultiSelectState,
} from "./ui/multi-select";
import {
  FindingRows,
  ScreenHeader,
  Section,
  SummaryStrip,
} from "./ui/tui";
import {
  OnboardingCredentialsPrompt,
  OnboardingDecisionPrompt,
  OnboardingIntro,
  OnboardingRuntimePrompt,
  PromptFrame,
  type PromptReceipt,
  type RuntimeChoiceOption,
} from "./ui/onboarding";
import { renderToString } from "./ui/render-to-string";
import { modelsComponent } from "../onboarding/models";
import { recommendedAgentsComponent } from "../onboarding/recommended-agents";
import { recommendedPluginsComponent } from "../onboarding/recommended-plugins";
import { mediaComponent } from "../onboarding/media";
import { searchComponent } from "../onboarding/search";
import { searchModelsComponent } from "../onboarding/search-models";
import type { CheckResult, OnboardingOptions } from "../onboarding/types";

interface CatalogChoice {
  id: string;
  name?: string;
  description?: string;
  defaultSelected?: boolean;
  state?: string;
}

export interface OnboardingSelections {
  selectedRecommendedPluginIds?: readonly string[];
  selectedRecommendedAgentIds?: readonly string[];
  approvedComponents?: readonly string[];
  renderedWizardScreens?: boolean;
}

function choicesFromCheck(check: CheckResult): CatalogChoice[] {
  const available = check.details?.available;
  if (!Array.isArray(available)) return [];
  return available
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object",
    )
    .map((entry) => ({
      id: String(entry.id ?? ""),
      name: typeof entry.name === "string" ? entry.name : undefined,
      description:
        typeof entry.description === "string" ? entry.description : undefined,
      defaultSelected: entry.defaultSelected === true,
      state: typeof entry.state === "string" ? entry.state : undefined,
    }))
    .filter((choice) => choice.id.length > 0);
}

function missingIdsFromCheck(check: CheckResult): Set<string> {
  const missing = check.details?.missing;
  if (!Array.isArray(missing)) return new Set();
  return new Set(
    missing.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    ),
  );
}

export function buildSelectionItems(check: CheckResult): MultiSelectItem[] {
  const missing = missingIdsFromCheck(check);
  return choicesFromCheck(check).map((choice) => ({
    id: choice.id,
    label: choice.name ?? choice.id,
    description:
      choice.state === "unmanaged"
        ? `${choice.description ?? ""} Adopt existing runtime agent.`.trim()
        : choice.description,
    selected: missing.has(choice.id) && choice.defaultSelected === true,
    disabled: !missing.has(choice.id),
    note: missing.has(choice.id) ? undefined : choice.state ?? "installed",
  }));
}

function MultiSelectPrompt({
  title,
  items,
  showBrand = true,
  onSubmit,
}: {
  title: string;
  items: MultiSelectItem[];
  showBrand?: boolean;
  onSubmit: (ids: string[]) => void;
}) {
  const [state, setState] = useState<MultiSelectState>(() =>
    createMultiSelectState(items),
  );
  const isAgentSelection = title.toLowerCase().includes("agent");
  const selectedCount = state.selectedIds.size;
  const availableCount = items.filter((item) => !item.disabled).length;
  const installedCount = items.filter((item) => item.disabled).length;

  return (
    <Box flexDirection="column">
      <ScreenHeader
        title="Onboard"
        subtitle={isAgentSelection ? "Choose official agents to install or adopt" : "Choose official plugins to install"}
        meta={isAgentSelection ? "agent selection" : "plugin selection"}
        showBrand={showBrand}
      />
      <SummaryStrip items={[
        { label: "selected", value: selectedCount, status: "ready" },
        { label: "available", value: availableCount },
        { label: "installed", value: installedCount, status: installedCount > 0 ? "ok" : "skip" },
      ]} />
      <Section title={isAgentSelection ? "Agents" : "Plugins"}>
        <MultiSelect
          title={title}
          items={items}
          state={state}
          onChange={setState}
          onSubmit={onSubmit}
          showTitle={false}
        />
      </Section>
      {items.some((item) => item.disabled) ? (
        <Section title={isAgentSelection ? "Runtime context" : "Install plan"}>
          <FindingRows rows={items.filter((item) => item.disabled).map((item) => ({
            status: "ok",
            label: item.label,
            message: item.note ? `${item.label} is already ${item.note}.` : `${item.label} is already installed.`,
          }))} />
        </Section>
      ) : null}
    </Box>
  );
}

/** The operator left the wizard (Ctrl-C) before answering. Nothing after it runs. */
export class OnboardingCancelledError extends Error {
  constructor() {
    super("Onboarding cancelled before setup ran.");
    this.name = "OnboardingCancelledError";
  }
}

/**
 * Show one wizard screen and wait for its answer. Ink unmounts the screen
 * on Ctrl-C without calling anything; left alone, the answer never arrives,
 * the event loop drains and the process exits 0 as if onboarding had
 * finished. An exit without an answer is a cancellation.
 */
function ask<T>(
  screen: (answer: (value: T) => void) => ReactElement,
  opts: { receipt: PromptReceipt<T>; showBrand?: boolean },
): Promise<T> {
  return new Promise((resolve, reject) => {
    let answered = false;
    const app = render(
      <PromptFrame
        screen={screen}
        receipt={opts.receipt}
        showBrand={opts.showBrand}
        onSettled={(value) => {
          answered = true;
          app.unmount();
          resolve(value);
        }}
      />,
    );
    const cancelled = () => {
      if (!answered) reject(new OnboardingCancelledError());
    };
    void app.waitUntilExit().then(cancelled, cancelled);
  });
}

/**
 * The guided credentials step. Runs between the bootstrap phase and the
 * wizard's questions — outside any operation, holding no lock, so the
 * operator can take as long as a login takes (and log in from another
 * terminal, which may itself need the runtime's files).
 *
 * `loggedIn` is asked first and again after every Enter; the step ends when
 * it answers true (`ready`) or the operator presses `s` (`skipped`). Nothing
 * is shown at all when a provider is already logged in.
 */
export async function waitForCredentials(input: {
  loggedIn: () => Promise<boolean>
  runtimeLabel: string
  steps: readonly string[]
  docsUrl: string
  showBrand?: boolean
}): Promise<{ outcome: "ready" | "skipped"; asked: boolean }> {
  let attempts = 0
  for (;;) {
    if (await input.loggedIn()) {
      if (attempts > 0) {
        console.log(renderToString(
          <FindingRows rows={[{ status: "ok", label: "Login", message: `Logged in to ${input.runtimeLabel}.` }]} />,
        ))
      }
      return { outcome: "ready", asked: attempts > 0 }
    }
    const showBrand = (input.showBrand ?? true) && attempts === 0
    const answer = await ask<"recheck" | "skip">((submit) => (
      <OnboardingCredentialsPrompt
        runtimeLabel={input.runtimeLabel}
        steps={input.steps}
        docsUrl={input.docsUrl}
        attempts={attempts}
        showBrand={showBrand}
        onSubmit={submit}
      />
    ), {
      showBrand,
      // A recheck leaves nothing: the next screen (or the login row) says how it went.
      receipt: (value) => value === "skip"
        ? { status: "warn", label: "Login", message: `Skipped. Agents run once you log in to ${input.runtimeLabel}.` }
        : null,
    })
    attempts += 1
    if (answer === "skip") return { outcome: "skipped", asked: true }
  }
}

/** Ask which runtime this home should use. Resolves with the chosen adapter id. */
export async function promptRuntimeChoice(
  options: RuntimeChoiceOption[],
  preselected: string,
): Promise<string> {
  return await ask<string>((answer) => (
    <OnboardingRuntimePrompt options={options} preselected={preselected} onSubmit={answer} />
  ), {
    showBrand: true,
    receipt: (adapter) => ({
      status: "ok",
      label: "Runtime",
      message: options.find((option) => option.adapter === adapter)?.label ?? adapter,
    }),
  });
}

export async function promptMultiSelect(
  title: string,
  items: MultiSelectItem[],
  opts: { showBrand?: boolean } = {},
): Promise<string[]> {
  if (items.filter((item) => !item.disabled).length === 0) return [];

  return await ask<string[]>((answer) => (
    <MultiSelectPrompt title={title} items={items} showBrand={opts.showBrand} onSubmit={answer} />
  ), {
    showBrand: opts.showBrand ?? true,
    receipt: (ids) => ({
      status: ids.length > 0 ? "ok" : "skip",
      label: title.toLowerCase().includes("agent") ? "Agents" : "Plugins",
      message: ids.length > 0
        ? ids.map((id) => items.find((item) => item.id === id)?.label ?? id).join(", ")
        : "None",
    }),
  });
}

async function promptConfirm(
  title: string,
  description: string,
  defaultChoice: "confirm" | "cancel" = "confirm",
  opts: { showBrand?: boolean } = {},
): Promise<boolean> {
  return await ask<boolean>((answer) => (
    <OnboardingDecisionPrompt
      title={title}
      description={description}
      defaultChoice={defaultChoice}
      showBrand={opts.showBrand}
      onSubmit={answer}
    />
  ), {
    showBrand: opts.showBrand ?? true,
    receipt: (approved) => ({
      status: approved ? "ok" : "skip",
      label: title,
      message: approved ? "Yes" : "Skipped",
    }),
  });
}

export async function collectOnboardingSelections(
  opts: Pick<OnboardingOptions, "autoApprove" | "json" | "checkOnly"> & {
    /** A terminal that can show the wizard. */
    interactive: boolean;
  },
  /**
   * What the bootstrap phase (home, settings, runtime) came to. The wizard
   * runs after it and never checks or provisions the runtime itself: with
   * no runtime there is nothing to ask about, and the run reports why.
   */
  bootstrap: {
    runtimeReady: boolean;
    /** An earlier screen of this run (the runtime question, the login step) already drew the brand. */
    brandShown?: boolean;
    /** Components the operator declined outright (`--no-recommended`): never asked about. */
    declined?: readonly string[];
  },
): Promise<OnboardingSelections> {
  if (!opts.interactive || opts.autoApprove || opts.json || opts.checkOnly)
    return {};
  if (!bootstrap.runtimeReady) return {};

  const searchCheck = await searchComponent.check();
  const searchModelsCheck = await searchModelsComponent.check();
  const mediaCheck = await mediaComponent.check();
  // A gateway flap mid-wizard must skip the plan step, not abort onboarding
  // (the orchestrator guards check() the same way).
  const modelsCheck: CheckResult = await modelsComponent.check().catch((err: unknown) => ({
    name: "models",
    status: "error",
    message: `check() threw: ${err instanceof Error ? err.message : String(err)}`,
  }));
  // A declined component is not checked (its check reaches for the catalog)
  // and not asked about: the operator already answered.
  const notAsked = (name: string): CheckResult => ({ name, status: "ok", message: "Declined; not asked" });
  const pluginCheck = bootstrap.declined?.includes("recommended-plugins")
    ? notAsked("recommended-plugins")
    : await recommendedPluginsComponent.check();
  const agentCheck = bootstrap.declined?.includes("recommended-agents")
    ? notAsked("recommended-agents")
    : await recommendedAgentsComponent.check();
  const hasWizardSteps = [
    searchCheck,
    searchModelsCheck,
    mediaCheck,
    modelsCheck,
    pluginCheck,
    agentCheck,
  ].some((check) => check.status === "missing" || check.status === "broken");
  // The intro opens a run whose first screen is the wizard. After the
  // runtime question or the login step the run is already under way, and
  // the intro would only sit between one answered step and the next.
  if (hasWizardSteps && bootstrap.brandShown !== true) {
    console.log(renderToString(<OnboardingIntro />));
  }

  const approvedComponents: string[] = [];
  const searchNeedsInstall =
    searchCheck.status === "missing" || searchCheck.status === "broken";
  const searchApproved = searchNeedsInstall
    ? await promptConfirm(
        "Search adapter",
        `${searchCheck.message}. Bakin will download its pinned search engine if you continue.`,
        "confirm",
        { showBrand: false },
      )
    : true;
  if (searchNeedsInstall && searchApproved) approvedComponents.push("search");

  if (
    searchApproved &&
    (searchModelsCheck.status === "missing" ||
      searchModelsCheck.status === "broken")
  ) {
    const approved = await promptConfirm(
      "Search models",
      `${searchModelsCheck.message}. Bakin will download the required search models if you continue.`,
      "confirm",
      { showBrand: false },
    );
    if (approved) approvedComponents.push("search-models");
  }

  if (mediaCheck.status === "missing" || mediaCheck.status === "broken") {
    const approved = await promptConfirm(
      "Image processing",
      `${mediaCheck.message.replace(/\.$/, "")}. Bakin will download its pinned image-processing prebuilds (~8 MB) if you continue.`,
      "confirm",
      { showBrand: false },
    );
    if (approved) approvedComponents.push("media");
  }


  // The recommended model plan (spec S7): shown with its reasons, applied
  // only on confirm — never behind the operator's back. `candidates: 0`
  // means nothing can run yet; the component skips itself with the hint.
  const planCandidates = typeof modelsCheck.details?.candidates === "number" ? modelsCheck.details.candidates : 0;
  if (modelsCheck.status === "missing" && planCandidates > 0) {
    const approved = await promptConfirm(
      "Model plan",
      `${modelsCheck.message} You can change it any time on the Models page.`,
      "confirm",
      { showBrand: false },
    );
    if (approved) approvedComponents.push("models");
  }

  const selectedRecommendedPluginIds =
    pluginCheck.status === "missing"
      ? await promptMultiSelect(
          "Install official plugins",
          buildSelectionItems(pluginCheck),
          { showBrand: false },
        )
      : undefined;
  const selectedRecommendedAgentIds =
    agentCheck.status === "missing"
      ? await promptMultiSelect(
          "Install official agents",
          buildSelectionItems(agentCheck),
          { showBrand: false },
        )
      : undefined;

  return {
    selectedRecommendedPluginIds,
    selectedRecommendedAgentIds,
    approvedComponents,
    renderedWizardScreens: hasWizardSteps,
  };
}

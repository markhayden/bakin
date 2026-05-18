import { render, renderToString, Box } from "ink";
import { useState } from "react";
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
  OnboardingDecisionPrompt,
  OnboardingIntro,
} from "./ui/onboarding";
import { recommendedAgentsComponent } from "../onboarding/recommended-agents";
import { recommendedPluginsComponent } from "../onboarding/recommended-plugins";
import { runtimeComponent } from "../onboarding/runtime";
import { searchComponent } from "../onboarding/search";
import { searchModelsComponent } from "../onboarding/search-models";
import { mcporterComponent } from "../onboarding/mcporter";
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
  onSubmit,
}: {
  title: string;
  items: MultiSelectItem[];
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

export async function promptMultiSelect(
  title: string,
  items: MultiSelectItem[],
): Promise<string[]> {
  if (items.filter((item) => !item.disabled).length === 0) return [];

  return await new Promise((resolve) => {
    let app: ReturnType<typeof render> | null = null;
    app = render(
      <MultiSelectPrompt
        title={title}
        items={items}
        onSubmit={(ids) => {
          app?.unmount();
          resolve(ids);
        }}
      />,
    );
  });
}

async function promptConfirm(
  title: string,
  description: string,
  defaultChoice: "confirm" | "cancel" = "confirm",
): Promise<boolean> {
  return await new Promise((resolve) => {
    let app: ReturnType<typeof render> | null = null;
    app = render(
      <OnboardingDecisionPrompt
        title={title}
        description={description}
        defaultChoice={defaultChoice}
        onSubmit={(approved) => {
          app?.unmount();
          resolve(approved);
        }}
      />,
    );
  });
}

export async function collectOnboardingSelections(
  opts: Pick<
    OnboardingOptions,
    "interactive" | "autoApprove" | "json" | "checkOnly"
  >,
): Promise<OnboardingSelections> {
  if (!opts.interactive || opts.autoApprove || opts.json || opts.checkOnly)
    return {};

  const runtime = await runtimeComponent.check();
  if (runtime.status !== "ok") return {};

  const searchCheck = await searchComponent.check();
  const searchModelsCheck = await searchModelsComponent.check();
  const mcporterCheck = await mcporterComponent.check();
  const pluginCheck = await recommendedPluginsComponent.check();
  const agentCheck = await recommendedAgentsComponent.check();
  const hasWizardSteps = [
    searchCheck,
    searchModelsCheck,
    mcporterCheck,
    pluginCheck,
    agentCheck,
  ].some((check) => check.status === "missing" || check.status === "broken");
  if (hasWizardSteps) {
    console.log(renderToString(<OnboardingIntro />));
  }

  const approvedComponents: string[] = [];
  const selectedRecommendedPluginIds =
    pluginCheck.status === "missing"
      ? await promptMultiSelect(
          "Install official plugins",
          buildSelectionItems(pluginCheck),
        )
      : undefined;
  const selectedRecommendedAgentIds =
    agentCheck.status === "missing"
      ? await promptMultiSelect(
          "Install official agents",
          buildSelectionItems(agentCheck),
        )
      : undefined;

  const searchNeedsInstall =
    searchCheck.status === "missing" || searchCheck.status === "broken";
  const searchApproved = searchNeedsInstall
    ? await promptConfirm(
        "Search adapter",
        `${searchCheck.message}. Bakin will install Antfly via Homebrew if you continue.`,
        "confirm",
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
      `${searchModelsCheck.message}. Bakin will download the required Termite models if you continue.`,
      "confirm",
    );
    if (approved) approvedComponents.push("search-models");
  }

  if (mcporterCheck.status === "missing" || mcporterCheck.status === "broken") {
    const approved = await promptConfirm(
      "MCP porter",
      `${mcporterCheck.message}. Bakin will install and configure mcporter if you continue.`,
      "confirm",
    );
    if (approved) approvedComponents.push("mcporter");
  }

  return {
    selectedRecommendedPluginIds,
    selectedRecommendedAgentIds,
    approvedComponents,
  };
}

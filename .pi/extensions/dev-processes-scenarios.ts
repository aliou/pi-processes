import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";

interface Scenario {
  name: string;
  path: string;
  prompts: Prompt[];
}

interface Prompt {
  name: string;
  path: string;
}


function loadScenarios(cwd: string): Scenario[] {
  const scenariosDir = join(cwd, "tests", "scenarios");
  if (!existsSync(scenariosDir)) return [];

  return readdirSync(scenariosDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const scenarioPath = join(scenariosDir, entry.name);
      const prompts = readdirSync(scenarioPath, { withFileTypes: true })
        .filter((file) => file.isFile() && file.name.toLowerCase() !== "readme.md")
        .map((file) => ({ name: file.name, path: join(scenarioPath, file.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return { name: entry.name, path: scenarioPath, prompts };
    })
    .filter((scenario) => scenario.prompts.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getLeadingNumber(name: string): number | undefined {
  const match = name.match(/^(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function findByNumber<T extends { name: string }>(items: T[], number: number): T | undefined {
  return items.find((item) => getLeadingNumber(item.name) === number);
}

function parseArgs(args: string): { scenario: number; prompt: number } | undefined {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length !== 2) throw new Error("Expected two numbers: <scenario> <prompt>");

  const [scenario, prompt] = parts.map(Number);
  if (!Number.isInteger(scenario) || !Number.isInteger(prompt)) {
    throw new Error("Expected two numbers: <scenario> <prompt>");
  }

  return { scenario, prompt };
}

function loadPromptIntoEditor(ctx: ExtensionCommandContext, promptPath: string): void {
  const content = readFileSync(promptPath, "utf8");
  ctx.ui.setEditorText(content);
  ctx.ui.notify(`Loaded ${relative(ctx.cwd, promptPath)} into editor`, "info");
}

interface PickerItem {
  label: string;
  description?: string;
  value: string;
}

async function pick(ctx: ExtensionCommandContext, title: string, items: PickerItem[]) {
  if (!ctx.hasUI) return null;

  return ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
    const settingsItems: SettingItem[] = items.map((item) => ({
      id: item.value,
      label: item.label,
      description: item.description,
      currentValue: "",
      values: ["selected"],
    }));

    const container = new Container();
    const list = new SettingsList(
      settingsItems,
      Math.min(settingsItems.length, 10),
      {
        label: (text, selected) => (selected ? theme.fg("accent", text) : text),
        value: (text, selected) => (selected ? theme.fg("accent", text) : theme.fg("muted", text)),
        description: (text) => theme.fg("muted", text),
        cursor: theme.fg("accent", "→ "),
        hint: (text) => theme.fg("dim", text),
      },
      (id) => done(id),
      () => done(null),
      { enableSearch: true },
    );

    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    container.addChild(list);
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

export default function devProcessesScenariosExtension(pi: ExtensionAPI) {
  pi.registerCommand("dev:processes:scenarios", {
    description: "Pick a process test scenario prompt and load it into the editor",
    handler: async (args, ctx) => {
      const scenarios = loadScenarios(ctx.cwd);
      if (scenarios.length === 0) {
        ctx.ui.notify("No scenarios found in tests/scenarios", "warning");
        return;
      }

      let parsedArgs: { scenario: number; prompt: number } | undefined;
      try {
        parsedArgs = parseArgs(args);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "Invalid arguments", "error");
        return;
      }

      if (parsedArgs) {
        const scenario = findByNumber(scenarios, parsedArgs.scenario);
        if (!scenario) {
          ctx.ui.notify(`Scenario ${parsedArgs.scenario} not found`, "error");
          return;
        }

        const prompt = findByNumber(scenario.prompts, parsedArgs.prompt);
        if (!prompt) {
          ctx.ui.notify(`Prompt ${parsedArgs.prompt} not found in ${scenario.name}`, "error");
          return;
        }

        loadPromptIntoEditor(ctx, prompt.path);
        return;
      }

      const scenarioName = await pick(
        ctx,
        "Select process scenario",
        scenarios.map((scenario) => ({
          label: scenario.name,
          description: `${scenario.prompts.length} prompt${scenario.prompts.length === 1 ? "" : "s"}`,
          value: scenario.name,
        })),
      );
      if (!scenarioName) return;

      const scenario = scenarios.find((candidate) => candidate.name === scenarioName);
      if (!scenario) return;

      const promptPath = await pick(
        ctx,
        `Select prompt for ${scenario.name}`,
        scenario.prompts.map((prompt) => ({
          label: prompt.name,
          description: relative(ctx.cwd, prompt.path),
          value: prompt.path,
        })),
      );
      if (!promptPath) return;

      loadPromptIntoEditor(ctx, promptPath);
    },
  });
}

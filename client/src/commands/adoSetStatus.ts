// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { OutputChannel, Uri, l10n, window, workspace } from "vscode";

import * as path from "path";

import { AdoClient, AdoWorkItem } from "../components/AdoClient";
import { ContentItem } from "../components/ContentNavigator/types";
import { getSecretStorage } from "../components/ExtensionContext";

interface AdoSessionConfig {
  organization: string;
  project: string;
  areaPath: string;
  iterationPath: string;
  pathFieldRefName: string;
}

const ADO_SECRET_NAMESPACE = "SAS_ADO_SECRET_STORAGE";
const DEFAULT_PAT_SECRET_KEY = "defaultPat";

const statusItems = [
  "New",
  "In Development",
  "In Validation",
  "In Production",
  "Done",
];

let outputChannel: OutputChannel | undefined;
let sessionConfig: AdoSessionConfig | undefined;

function getOutputChannel(): OutputChannel {
  if (!outputChannel) {
    outputChannel = window.createOutputChannel("SAS Azure DevOps");
  }

  return outputChannel;
}

async function resolvePat(): Promise<string> {
  const envVarName = workspace
    .getConfiguration("SAS")
    .get<string>("ado.patEnvVar", "ADO_PAT");
  const envPat = process.env[envVarName || "ADO_PAT"]?.trim();
  if (envPat) {
    return envPat;
  }

  const secretStorage = getSecretStorage<string>(ADO_SECRET_NAMESPACE);
  const storedPat = (await secretStorage.get(DEFAULT_PAT_SECRET_KEY))?.trim();
  if (storedPat) {
    return storedPat;
  }

  throw new Error(
    l10n.t(
      "Azure DevOps PAT not found. Set {name} or run 'SAS: Set Azure DevOps PAT'.",
      { name: envVarName || "ADO_PAT" },
    ),
  );
}

function logCandidates(
  channel: OutputChannel,
  items: AdoWorkItem[],
  label: string,
): void {
  channel.appendLine(`[ADO] ${label}: ${items.length} item(s)`);
  const preview = items.slice(0, 30);
  preview.forEach((item) => {
    channel.appendLine(
      `[ADO] - #${item.id} | title='${item.title}' | state='${item.state}' | path='${item.filePath || ""}'`,
    );
  });

  if (items.length > preview.length) {
    channel.appendLine(
      `[ADO] ... ${items.length - preview.length} additional item(s) omitted from preview.`,
    );
  }
}

async function pickWorkItem(
  items: AdoWorkItem[],
  title: string,
  placeHolder: string,
): Promise<AdoWorkItem | undefined> {
  if (items.length === 0) {
    return undefined;
  }

  const selected = await window.showQuickPick(
    items.map((item) => ({
      label: `#${item.id} ${item.title}`,
      description: item.state,
      detail: item.filePath || "(empty path field)",
      item,
    })),
    {
      title,
      placeHolder,
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );

  return selected?.item;
}

export async function configureAdoSession(): Promise<void> {
  const current = sessionConfig;
  const organization = await window.showInputBox({
    prompt: l10n.t("Azure DevOps organization"),
    placeHolder: l10n.t("contoso"),
    value: current?.organization,
    ignoreFocusOut: true,
  });
  if (!organization) {
    return;
  }

  const project = await window.showInputBox({
    prompt: l10n.t("Azure DevOps project"),
    placeHolder: l10n.t("Project name"),
    value: current?.project,
    ignoreFocusOut: true,
  });
  if (!project) {
    return;
  }

  const areaPath = await window.showInputBox({
    prompt: l10n.t("Area path for backlog item lookup"),
    placeHolder: l10n.t("Project\\Team"),
    value: current?.areaPath,
    ignoreFocusOut: true,
  });
  if (!areaPath) {
    return;
  }

  const iterationPath = await window.showInputBox({
    prompt: l10n.t("Iteration path for backlog item lookup"),
    placeHolder: l10n.t("Project\\Iteration"),
    value: current?.iterationPath,
    ignoreFocusOut: true,
  });
  if (!iterationPath) {
    return;
  }

  const pathFieldRefName = await window.showInputBox({
    prompt: l10n.t("Custom field refname that stores file path"),
    placeHolder: l10n.t("Custom.PathToFile"),
    value: current?.pathFieldRefName || "Custom.PathToFile",
    ignoreFocusOut: true,
  });
  if (!pathFieldRefName) {
    return;
  }

  sessionConfig = {
    organization: organization.trim(),
    project: project.trim(),
    areaPath: areaPath.trim(),
    iterationPath: iterationPath.trim(),
    pathFieldRefName: pathFieldRefName.trim(),
  };

  window.showInformationMessage(
    l10n.t("Azure DevOps session configured for {project}.", {
      project: sessionConfig.project,
    }),
  );
}

export async function setAdoPat(): Promise<void> {
  const secretStorage = getSecretStorage<string>(ADO_SECRET_NAMESPACE);
  const value = await window.showInputBox({
    prompt: l10n.t("Enter Azure DevOps PAT"),
    password: true,
    ignoreFocusOut: true,
  });

  if (!value) {
    return;
  }

  await secretStorage.store(DEFAULT_PAT_SECRET_KEY, value.trim());
  window.showInformationMessage(l10n.t("Azure DevOps PAT stored securely."));
}

// For sasServer:/sasContent: URIs the real server file path is embedded in the
// ?id= query param as a compute API path: /compute/sessions/{id}/files/~fs~dir~fs~file
// uri.path only contains the filename — decode the full path from the id param instead.
function resolveServerFilePath(uri: Uri): string {
  if (
    uri.scheme === "sasServer" ||
    uri.scheme === "sasServerReadOnly" ||
    uri.scheme === "sasContent" ||
    uri.scheme === "sasContentReadOnly"
  ) {
    const resourceId = uri.query.substring(3); // strip leading "id="
    const filesMarker = "/files/";
    const idx = resourceId.lastIndexOf(filesMarker);
    if (idx !== -1) {
      const rawPath = resourceId.substring(idx + filesMarker.length);
      return decodeURIComponent(rawPath.split("~fs~").join("/").replace(/~sc~/g, ";"));
    }
  }
  return uri.path;
}

function resolveTargetUri(resource?: Uri | ContentItem): Uri | undefined {
  if (!resource) {
    return window.activeTextEditor?.document.uri;
  }

  if (resource instanceof Uri) {
    return resource;
  }

  if (resource.vscUri) {
    return resource.vscUri;
  }

  if (resource.uri) {
    return Uri.parse(resource.uri);
  }

  return undefined;
}

function isSasFileTarget(
  uri: Uri | undefined,
  resource?: Uri | ContentItem,
): boolean {
  const extensions = [
    uri?.fsPath,
    uri?.path,
    resource && !(resource instanceof Uri) ? resource.name : undefined,
  ]
    .filter((value): value is string => !!value)
    .map((value) => path.extname(value).toLowerCase());

  return extensions.includes(".sas");
}

export async function setBliStatus(
  resource?: Uri | ContentItem,
): Promise<void> {
  const uri = resolveTargetUri(resource);
  if (!uri || !isSasFileTarget(uri, resource)) {
    window.showErrorMessage(l10n.t("Select a SAS file to update BLI status."));
    return;
  }

  if (!sessionConfig) {
    window.showErrorMessage(
      l10n.t(
        "Azure DevOps session is not configured. Run 'SAS: Configure Azure DevOps Session'.",
      ),
    );
    return;
  }

  const selectedStatus = await window.showQuickPick(statusItems, {
    title: l10n.t("Select backlog item status"),
    placeHolder: l10n.t("Choose a status"),
    ignoreFocusOut: true,
  });

  if (!selectedStatus) {
    return;
  }

  const filePath = resolveServerFilePath(uri);

  const channel = getOutputChannel();
  channel.appendLine(
    `[ADO] URI scheme='${uri.scheme}' uri.path='${uri.path}' resolved filePath='${filePath}'`,
  );
  try {
    const pat = await resolvePat();
    const client = new AdoClient(
      sessionConfig.organization,
      sessionConfig.project,
      pat,
      channel,
    );

    await client.validateConnection();
    await client.ensureProjectExists();

    const resolvedPathFieldRefName = await client.resolvePathFieldReferenceName(
      sessionConfig.pathFieldRefName,
    );
    if (resolvedPathFieldRefName !== sessionConfig.pathFieldRefName) {
      channel.appendLine(
        `[ADO] Resolved path field '${sessionConfig.pathFieldRefName}' -> '${resolvedPathFieldRefName}'`,
      );
    }

    channel.appendLine(
      `[ADO] Looking up work item for path '${filePath}' using field '${resolvedPathFieldRefName}'`,
    );

    // First attempt: area + iteration + explicit path value in WIQL
    let matches = await client.listWorkItems({
      areaPath: sessionConfig.areaPath,
      iterationPath: sessionConfig.iterationPath,
      pathFieldRefName: resolvedPathFieldRefName,
      filePath,
    });

    if (matches.length === 0) {
      channel.appendLine(
        `[ADO] No match with Area+Iteration scope. Retrying with Area-only scope '${sessionConfig.areaPath}'.`,
      );
      // Second attempt: area-only + same explicit path value
      matches = await client.listWorkItems({
        areaPath: sessionConfig.areaPath,
        pathFieldRefName: resolvedPathFieldRefName,
        filePath,
      });
    }

    channel.appendLine(
      `[ADO] Found ${matches.length} item(s) for path '${filePath}'.`,
    );

    let targetItem: AdoWorkItem | undefined;

    if (matches.length === 0) {
      // Fallback: fetch all items in area scope for manual pick
      const allScopedItems = await client.listWorkItems({
        areaPath: sessionConfig.areaPath,
        pathFieldRefName: resolvedPathFieldRefName,
      });

      logCandidates(
        channel,
        allScopedItems,
        "Candidates returned by ADO lookup (no path filter)",
      );
      channel.show(true);

      const chooseFromCandidates = await window.showWarningMessage(
        l10n.t(
          "No backlog item was found for '{filePath}'. {count} item(s) are in scope. Do you want to select one manually?",
          { filePath, count: String(allScopedItems.length) },
        ),
        l10n.t("Select Item"),
      );

      if (chooseFromCandidates === l10n.t("Select Item")) {
        targetItem = await pickWorkItem(
          allScopedItems,
          l10n.t("Select backlog item to update"),
          l10n.t("Choose one of the items returned by the current ADO filter"),
        );
      }

      if (!targetItem) {
        window.showErrorMessage(
          l10n.t(
            "No backlog item matched path '{filePath}'. See 'SAS Azure DevOps' output for details.",
            { filePath },
          ),
        );
        return;
      }
    } else if (matches.length > 1) {
      logCandidates(channel, matches, "Multiple matches");
      channel.show(true);

      targetItem = await pickWorkItem(
        matches,
        l10n.t("Multiple backlog items matched '{filePath}'", { filePath }),
        l10n.t("Choose the backlog item to update"),
      );

      if (!targetItem) {
        window.showErrorMessage(
          l10n.t(
            "Multiple backlog items matched path '{filePath}'. No update was made.",
            { filePath },
          ),
        );
        return;
      }
    } else {
      targetItem = matches[0];
    }

    await client.updateWorkItemState(targetItem.id, selectedStatus);

    window.showInformationMessage(
      l10n.t("Backlog item #{id} updated to {state}.", {
        id: String(targetItem.id),
        state: selectedStatus,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    channel.appendLine(`[ADO] Error: ${message}`);
    channel.show(true);
    window.showErrorMessage(
      l10n.t("Failed to update backlog item status: {message}", { message }),
    );
  }
}

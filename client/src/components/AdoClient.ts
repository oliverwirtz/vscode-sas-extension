// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { OutputChannel } from "vscode";

export interface AdoWorkItem {
  id: number;
  title: string;
  state: string;
  filePath?: string;
}

interface WiqlResult {
  workItems?: { id: number }[];
}

interface WorkItemsBatchResult {
  value?: Array<{ id: number; fields?: Record<string, string> }>;
}

export interface AdoLookupRequest {
  areaPath?: string;
  iterationPath?: string;
  pathFieldRefName: string;
  filePath?: string;
}

interface ProjectListResult {
  value?: Array<{ id: string; name: string }>;
}

interface FieldCatalogResult {
  value?: Array<{ name?: string; referenceName?: string }>;
}

export class AdoClient {
  constructor(
    private readonly organization: string,
    private readonly project: string,
    private readonly authHeader: string,
    private readonly outputChannel?: OutputChannel,
    private readonly apiVersion = "7.1",
  ) {}

  async validateConnection(): Promise<void> {
    await this.request<ProjectListResult>(
      `/_apis/projects?$top=1&api-version=${this.apiVersion}`,
      {
        method: "GET",
      },
    );
  }

  async ensureProjectExists(): Promise<void> {
    const response =
      (await this.request<ProjectListResult>(
        `/_apis/projects?api-version=${this.apiVersion}`,
        {
          method: "GET",
        },
      )) || {};

    const match = (response.value || []).find(
      (project) =>
        project.name.localeCompare(this.project, undefined, {
          sensitivity: "accent",
        }) === 0,
    );

    if (!match) {
      throw new Error(
        `Azure DevOps project '${this.project}' was not found in organization '${this.organization}'.`,
      );
    }
  }

  async resolvePathFieldReferenceName(
    requestedFieldName: string,
  ): Promise<string> {
    const trimmed = requestedFieldName.trim();
    if (!trimmed) {
      throw new Error("Path field name cannot be empty.");
    }

    const fieldCatalog =
      (await this.request<FieldCatalogResult>(
        `/_apis/wit/fields?api-version=${this.apiVersion}`,
        {
          method: "GET",
        },
      )) || {};

    const fields = fieldCatalog.value || [];
    if (fields.length === 0) {
      return trimmed;
    }

    const requestedNormalized = this.normalizeFieldName(trimmed);

    const match = fields.find((field) => {
      const ref = (field.referenceName || "").trim();
      const name = (field.name || "").trim();

      if (!ref && !name) {
        return false;
      }

      if (
        ref.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0
      ) {
        return true;
      }

      if (
        name &&
        name.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0
      ) {
        return true;
      }

      if (this.normalizeFieldName(ref) === requestedNormalized) {
        return true;
      }

      if (this.normalizeFieldName(name) === requestedNormalized) {
        return true;
      }

      const suffix = ref.split(".").pop() || ref;
      return this.normalizeFieldName(suffix) === requestedNormalized;
    });

    return (match?.referenceName || trimmed).trim();
  }

  async listWorkItems(request: AdoLookupRequest): Promise<AdoWorkItem[]> {
    const wiql = this.buildLookupWiql(
      request.areaPath,
      request.iterationPath,
      request.pathFieldRefName,
      request.filePath,
    );
    const wiqlResponse =
      (await this.request<WiqlResult>(
        `/${encodeURIComponent(this.project)}/_apis/wit/wiql?api-version=${this.apiVersion}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: wiql }),
        },
      )) || {};

    const ids = (wiqlResponse.workItems || []).map((item) => item.id);
    if (ids.length === 0) {
      return [];
    }

    const BATCH_SIZE = 200;
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      chunks.push(ids.slice(i, i + BATCH_SIZE));
    }

    const batchResults = await Promise.all(
      chunks.map((chunk) =>
        this.request<WorkItemsBatchResult>(
          `/${encodeURIComponent(this.project)}/_apis/wit/workitemsbatch?api-version=${this.apiVersion}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ids: chunk,
              fields: [
                "System.Title",
                "System.State",
                request.pathFieldRefName,
              ],
            }),
          },
        ),
      ),
    );

    const rows = batchResults.flatMap((r) => r?.value || []);
    const withFieldKey = rows.filter((item) => {
      const fields = item.fields || {};
      return Object.prototype.hasOwnProperty.call(
        fields,
        request.pathFieldRefName,
      );
    }).length;
    const withNonEmptyField = rows.filter((item) => {
      const fields = item.fields || {};
      const value = fields[request.pathFieldRefName];
      return typeof value === "string" && value.trim().length > 0;
    }).length;

    this.outputChannel?.appendLine(
      `[ADO] Field diagnostics for '${request.pathFieldRefName}': returned ${rows.length} item(s), key present on ${withFieldKey}, non-empty value on ${withNonEmptyField}.`,
    );

    if (rows.length > 0 && withFieldKey === 0) {
      const firstFields = Object.keys(rows[0].fields || {})
        .slice(0, 20)
        .join(", ");
      this.outputChannel?.appendLine(
        `[ADO] The requested field key was not present in returned rows. Example available fields: ${firstFields}`,
      );
    }

    return rows.map((item) => {
      const fields = item.fields || {};
      return {
        id: item.id,
        title: fields["System.Title"] || "",
        state: fields["System.State"] || "",
        filePath: fields[request.pathFieldRefName],
      };
    });
  }

  async updateWorkItemState(id: number, state: string): Promise<void> {
    await this.request(
      `/${encodeURIComponent(this.project)}/_apis/wit/workitems/${id}?api-version=${this.apiVersion}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json-patch+json",
        },
        body: JSON.stringify([
          {
            op: "add",
            path: "/fields/System.State",
            value: state,
          },
        ]),
      },
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
  ): Promise<T | undefined> {
    const url = `https://dev.azure.com/${this.organization}${path}`;

    this.outputChannel?.appendLine(`[ADO] ${init.method || "GET"} ${url}`);

    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      const bodyText = await response.text();
      this.outputChannel?.appendLine(
        `[ADO] request failed (${response.status}): ${bodyText}`,
      );
      throw new Error(
        this.buildRequestFailureMessage(response.status, response.statusText),
      );
    }

    const text = await response.text();
    if (!text) {
      return undefined;
    }

    return this.parseJson<T>(text);
  }

  private parseJson<T>(text: string): T {
    return JSON.parse(text);
  }

  private buildRequestFailureMessage(
    status: number,
    statusText: string,
  ): string {
    const hint =
      status === 401
        ? "Authentication failed. Sign in with your Microsoft account or check your PAT."
        : status === 403
          ? "Access denied. Verify you have permission to access this organization/project."
          : status === 404
            ? "Resource not found. Verify organization, project, and field names."
            : "Unexpected Azure DevOps error.";

    return `Azure DevOps request failed (${status} ${statusText}). ${hint}`;
  }

  private normalizeFieldName(value: string): string {
    return value.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  }

  private buildLookupWiql(
    areaPath?: string,
    iterationPath?: string,
    pathFieldRefName?: string,
    filePath?: string,
  ): string {
    const queryParts = [
      "SELECT [System.Id]",
      "FROM WorkItems",
      "WHERE [System.TeamProject] = @project",
      "ORDER BY [System.ChangedDate] DESC",
    ];

    const trimmedAreaPath = areaPath?.trim();
    if (trimmedAreaPath) {
      queryParts.splice(
        queryParts.length - 1,
        0,
        `AND [System.AreaPath] UNDER '${trimmedAreaPath.replace(/'/g, "''")}'`,
      );
    }

    const trimmedIterationPath = iterationPath?.trim();
    if (trimmedIterationPath) {
      queryParts.splice(
        queryParts.length - 1,
        0,
        `AND [System.IterationPath] UNDER '${trimmedIterationPath.replace(/'/g, "''")}'`,
      );
    }

    const trimmedPathFieldRefName = pathFieldRefName?.trim();
    const trimmedFilePath = filePath?.trim();
    if (trimmedPathFieldRefName && trimmedFilePath) {
      queryParts.splice(
        queryParts.length - 1,
        0,
        `AND [${trimmedPathFieldRefName}] = '${trimmedFilePath.replace(/'/g, "''")}'`,
      );
    }

    return queryParts.join(" ");
  }
}

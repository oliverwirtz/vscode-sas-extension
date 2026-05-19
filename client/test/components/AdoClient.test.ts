import { expect } from "chai";
import sinon from "sinon";

import { AdoClient } from "../../src/components/AdoClient";

describe("AdoClient", () => {
  let client: AdoClient;
  let requestStub: sinon.SinonStub;

  beforeEach(() => {
    client = new AdoClient("contoso", "Project", "pat");
    requestStub = sinon.stub(client as any, "request");
  });

  afterEach(() => {
    sinon.restore();
  });

  it("throws when path field name is empty", async () => {
    let message = "";

    try {
      await client.resolvePathFieldReferenceName("   ");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).to.equal("Path field name cannot be empty.");
  });

  it("returns trimmed input when field catalog is empty", async () => {
    requestStub.resolves({ value: [] });

    const resolved = await client.resolvePathFieldReferenceName(
      "  Custom.PathToFile  ",
    );

    expect(resolved).to.equal("Custom.PathToFile");
  });

  it("resolves field by normalized suffix match", async () => {
    requestStub.resolves({
      value: [
        { name: "Path To File", referenceName: "Custom.PathToFile" },
        { name: "Other", referenceName: "Custom.Other" },
      ],
    });

    const resolved = await client.resolvePathFieldReferenceName("pathtofile");

    expect(resolved).to.equal("Custom.PathToFile");
  });

  it("maps work items from batch response", async () => {
    requestStub
      .onFirstCall()
      .resolves({ workItems: [{ id: 10 }, { id: 11 }] })
      .onSecondCall()
      .resolves({
        value: [
          {
            id: 10,
            fields: {
              "System.Title": "alpha.sas",
              "System.State": "New",
              "Custom.PathToFile": "/tmp/alpha.sas",
            },
          },
          {
            id: 11,
            fields: {
              "System.Title": "beta.sas",
              "System.State": "Done",
              "Custom.PathToFile": "/tmp/beta.sas",
            },
          },
        ],
      });

    const result = await client.listWorkItems({
      areaPath: "Project\\Team's",
      iterationPath: "Project\\Sprint 1",
      pathFieldRefName: "Custom.PathToFile",
    });

    expect(result).to.deep.equal([
      {
        id: 10,
        title: "alpha.sas",
        state: "New",
        filePath: "/tmp/alpha.sas",
      },
      {
        id: 11,
        title: "beta.sas",
        state: "Done",
        filePath: "/tmp/beta.sas",
      },
    ]);

    const wiqlRequest = requestStub.firstCall.args[1] as RequestInit;
    const wiqlBody = JSON.parse(wiqlRequest.body as string) as {
      query: string;
    };

    expect(wiqlBody.query).to.include("UNDER 'Project\\Team''s'");
    expect(wiqlBody.query).to.include("UNDER 'Project\\Sprint 1'");
  });

  it("uses patch payload to update work item state", async () => {
    requestStub.resolves(undefined);

    await client.updateWorkItemState(42, "In Validation");

    const requestPath = requestStub.firstCall.args[0] as string;
    const requestInit = requestStub.firstCall.args[1] as RequestInit;
    const patch = JSON.parse(requestInit.body as string) as Array<{
      op: string;
      path: string;
      value: string;
    }>;

    expect(requestPath).to.include("/workitems/42?");
    expect(requestInit.method).to.equal("PATCH");
    expect(patch).to.deep.equal([
      {
        op: "add",
        path: "/fields/System.State",
        value: "In Validation",
      },
    ]);
  });
});

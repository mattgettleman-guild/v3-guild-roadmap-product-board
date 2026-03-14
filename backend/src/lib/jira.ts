import type { JiraAttributes, JiraLink, RoadmapChildItem } from "@roadmap/shared";

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrl?: string;
  active: boolean;
}

type AuthMode = "oauth" | "api_token" | "none";

let connectionSettings: any;
let cachedCloudId: string | null = null;
let cachedSiteUrl: string | null = null;
let cachedAccessToken: string | null = null;
let cachedExpiresAt: number = 0;

function getAuthMode(): AuthMode {
  if (process.env.REPLIT_CONNECTORS_HOSTNAME) return "oauth";
  if (process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN && process.env.JIRA_BASE_URL) return "api_token";
  return "none";
}

function getApiTokenHeaders(): { Authorization: string; "Content-Type": string; Accept: string } {
  const email = process.env.JIRA_EMAIL!;
  const token = process.env.JIRA_API_TOKEN!;
  const encoded = Buffer.from(`${email}:${token}`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function getApiTokenBaseUrl(): string {
  return process.env.JIRA_BASE_URL!.replace(/\/+$/, "");
}

async function getJiraHeaders(): Promise<{ headers: Record<string, string>; apiHost: string; siteUrl: string }> {
  const mode = getAuthMode();

  if (mode === "api_token") {
    const baseUrl = getApiTokenBaseUrl();
    return {
      headers: getApiTokenHeaders(),
      apiHost: baseUrl,
      siteUrl: baseUrl,
    };
  }

  if (mode === "oauth") {
    const { accessToken, apiHost, siteUrl } = await getAccessToken();
    return {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      apiHost,
      siteUrl,
    };
  }

  throw new Error(
    "Jira is not configured. Either set up the Replit Jira connector (OAuth) or provide JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_BASE_URL environment variables.",
  );
}

async function getAccessToken(): Promise<{ accessToken: string; apiHost: string; siteUrl: string }> {
  if (cachedAccessToken && cachedCloudId && cachedSiteUrl && cachedExpiresAt > Date.now()) {
    return {
      accessToken: cachedAccessToken,
      apiHost: `https://api.atlassian.com/ex/jira/${cachedCloudId}`,
      siteUrl: cachedSiteUrl,
    };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken || !hostname) {
    throw new Error("Replit connector environment not available");
  }

  connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=jira",
    {
      headers: {
        Accept: "application/json",
        X_REPLIT_TOKEN: xReplitToken,
      },
    },
  )
    .then((res) => res.json())
    .then((data: any) => data.items?.[0]);

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;
  const siteUrl = connectionSettings?.settings?.site_url;
  const expiresAt = connectionSettings?.settings?.oauth?.credentials?.expires_at;

  if (!connectionSettings || !accessToken || !siteUrl) {
    throw new Error("Jira not connected");
  }

  const resourcesRes = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!resourcesRes.ok) {
    throw new Error(`Failed to fetch accessible resources: ${resourcesRes.status}`);
  }

  const resources = await resourcesRes.json() as any[];
  if (!resources.length) {
    throw new Error("No accessible Jira sites found");
  }

  const cloudId = resources[0].id;

  cachedAccessToken = accessToken;
  cachedCloudId = cloudId;
  cachedSiteUrl = siteUrl;
  cachedExpiresAt = expiresAt ? new Date(expiresAt).getTime() - 60000 : Date.now() + 3000000;

  const apiHost = `https://api.atlassian.com/ex/jira/${cloudId}`;
  console.log("Jira connector: apiHost =", apiHost, "| siteUrl =", siteUrl, "| token present:", Boolean(accessToken));
  return { accessToken, apiHost, siteUrl };
}

async function jiraSearchJql(jql: string, fields: string[], maxResults: number, nextPageToken?: string): Promise<any> {
  const { headers, apiHost } = await getJiraHeaders();
  const body: any = { jql, fields, maxResults };
  if (nextPageToken) body.nextPageToken = nextPageToken;
  const res = await fetch(`${apiHost}/rest/api/3/search/jql`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`Jira search failed (${res.status}): ${errText}`);
    throw new Error(`Jira search failed (${res.status}): ${errText}`);
  }
  return res.json();
}

async function jiraGetIssue(issueKey: string, fields: string[]): Promise<any> {
  const { headers, apiHost } = await getJiraHeaders();
  const params = new URLSearchParams({ fields: fields.join(",") });
  const res = await fetch(`${apiHost}/rest/api/3/issue/${issueKey}?${params}`, {
    headers,
  });
  if (!res.ok) {
    throw new Error(`Jira get issue failed (${res.status})`);
  }
  return res.json();
}

function isJiraAvailable(): boolean {
  return getAuthMode() !== "none";
}

const mockInitiatives = [
  {
    key: "GR-101",
    summary: "Build payment-agnostic search and discovery",
    url: "https://example.atlassian.net/browse/GR-101",
    attributes: {
      labels: ["search", "growth"],
      status: "In Progress",
      assignee: "Megan",
      priority: "High",
      startDate: "2026-02-10",
      endDate: "2026-06-25",
      components: ["Growth"],
      customFields: { confidence: "medium" },
    },
  },
  {
    key: "GR-142",
    summary: "Build self-serve exceptions management",
    url: "https://example.atlassian.net/browse/GR-142",
    attributes: {
      labels: ["platform", "self-serve"],
      status: "Planned",
      assignee: "Dani",
      priority: "Medium",
      startDate: "2026-04-01",
      endDate: "2026-09-30",
      components: ["Platform"],
      customFields: { confidence: "high" },
    },
  },
];

const mockChildren: Record<string, RoadmapChildItem[]> = {
  "GR-101": [
    {
      key: "EPIC-300",
      title: "Universalize all payment modality applications",
      type: "epic",
      url: "https://example.atlassian.net/browse/EPIC-300",
    },
    {
      key: "STORY-991",
      title: "Refactor search ranking signal scoring",
      type: "story",
      url: "https://example.atlassian.net/browse/STORY-991",
    },
  ],
  "GR-142": [
    {
      key: "EPIC-412",
      title: "Exceptions admin foundation",
      type: "epic",
      url: "https://example.atlassian.net/browse/EPIC-412",
    },
  ],
};

export async function searchLinkableIssues(query: string): Promise<JiraLink[]> {
  if (!isJiraAvailable()) {
    return searchMock(query);
  }

  try {
    const { siteUrl } = await getJiraHeaders();
    const searchFields = ["summary", "status", "assignee", "priority", "labels", "components", "issuetype"];

    const keyPattern = /^[A-Z][A-Z0-9]+-\d+$/i;
    const tokens = query.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
    const keys = tokens.filter((t) => keyPattern.test(t));

    let jql: string;
    if (keys.length > 1) {
      const keyList = keys.map((k) => `"${k.toUpperCase()}"`).join(", ");
      jql = `key in (${keyList}) ORDER BY key ASC`;
    } else if (keys.length === 1) {
      jql = `key = "${keys[0].toUpperCase()}" ORDER BY updated DESC`;
    } else {
      const escaped = query.replace(/"/g, '\\"');
      jql = `text ~ "${escaped}" ORDER BY updated DESC`;
    }

    const data = await jiraSearchJql(jql, searchFields, keys.length > 1 ? keys.length : 20);

    const mapIssue = (issue: any): JiraLink => {
      const fields = issue.fields || {};
      const issueTypeName = (fields.issuetype?.name || "").toLowerCase();
      const isInitiative = issueTypeName.includes("initiative");
      return {
        id: issue.key,
        key: issue.key,
        title: fields.summary || issue.key,
        issueType: isInitiative ? "initiative" : "epic",
        url: `${siteUrl}/browse/${issue.key}`,
        jiraAttributes: {
          labels: fields.labels || [],
          status: fields.status?.name,
          assignee: fields.assignee?.displayName,
          priority: fields.priority?.name,
          components: (fields.components || []).map((c: any) => c.name),
          customFields: {},
        },
      } as JiraLink;
    };

    return (data.issues || []).map(mapIssue);
  } catch (err) {
    console.error("Jira search failed, falling back to mock:", (err as Error).message);
    return searchMock(query);
  }
}

function searchMock(query: string): JiraLink[] {
  const base = mockInitiatives
    .filter((issue) =>
      `${issue.key} ${issue.summary}`.toLowerCase().includes(query.toLowerCase()),
    )
    .map((issue) => ({
      id: issue.key,
      key: issue.key,
      title: issue.summary,
      issueType: "initiative" as const,
      url: issue.url,
      jiraAttributes: issue.attributes,
    }));
  const epics: JiraLink[] = [
    {
      id: "EPIC-300",
      key: "EPIC-300",
      title: "Universalize all payment modality applications",
      issueType: "epic" as const,
      url: "https://example.atlassian.net/browse/EPIC-300",
    },
    {
      id: "EPIC-412",
      key: "EPIC-412",
      title: "Exceptions admin foundation",
      issueType: "epic" as const,
      url: "https://example.atlassian.net/browse/EPIC-412",
    },
  ].filter((issue) =>
    `${issue.key} ${issue.title}`.toLowerCase().includes(query.toLowerCase()),
  );
  return [...base, ...epics];
}

export async function fetchChildren(issueKey: string): Promise<RoadmapChildItem[]> {
  if (!isJiraAvailable()) {
    return mockChildren[issueKey] ?? [];
  }

  try {
    const { siteUrl } = await getJiraHeaders();
    const jql = `parent = ${issueKey} ORDER BY created ASC`;

    const data = await jiraSearchJql(jql, ["summary", "issuetype"], 50);

    return (data.issues || []).map((issue: any) => ({
      key: issue.key,
      title: issue.fields?.summary || issue.key,
      type: (issue.fields?.issuetype?.name || "").toLowerCase().includes("epic")
        ? "epic"
        : "story",
      url: `${siteUrl}/browse/${issue.key}`,
    }));
  } catch (err) {
    console.error("Jira fetchChildren failed, falling back to mock:", (err as Error).message);
    return mockChildren[issueKey] ?? [];
  }
}

export async function fetchAttributes(issueKey: string): Promise<JiraAttributes> {
  if (!isJiraAvailable()) {
    const issue = mockInitiatives.find((i) => i.key === issueKey);
    return issue?.attributes ?? { labels: [], components: [], customFields: {} };
  }

  try {
    const issue = await jiraGetIssue(
      issueKey,
      ["labels", "status", "assignee", "priority", "components", "duedate", "customfield_10015"],
    );

    const fields = issue.fields || ({} as any);
    return {
      labels: fields.labels || [],
      status: fields.status?.name,
      assignee: fields.assignee?.displayName,
      priority: fields.priority?.name,
      startDate: fields.customfield_10015,
      endDate: fields.duedate,
      components: (fields.components || []).map((c: any) => c.name),
      customFields: {},
    };
  } catch (err) {
    console.error("Jira fetchAttributes failed, falling back to mock:", (err as Error).message);
    const issue = mockInitiatives.find((i) => i.key === issueKey);
    return issue?.attributes ?? { labels: [], components: [], customFields: {} };
  }
}

export interface JiraAccomplishment {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  resolution?: string;
  assignee?: string;
  priority?: string;
  labels: string[];
  components: string[];
  resolvedDate?: string;
  updatedDate?: string;
  createdDate?: string;
  url: string;
}

export async function fetchAccomplishments(opts?: {
  startDate?: string;
  endDate?: string;
  maxResults?: number;
}): Promise<JiraAccomplishment[]> {
  if (!isJiraAvailable()) {
    return getMockAccomplishments(opts);
  }

  try {
    const { siteUrl } = await getJiraHeaders();

    let jql = `status in (Done, Closed, Resolved, Completed) AND issuetype in (Initiative, Epic)`;
    if (opts?.startDate) {
      jql += ` AND resolutiondate >= "${opts.startDate}"`;
    }
    if (opts?.endDate) {
      jql += ` AND resolutiondate <= "${opts.endDate}"`;
    }
    jql += ` ORDER BY resolutiondate DESC`;

    const fields = [
      "summary", "status", "resolution", "assignee", "priority",
      "labels", "components", "issuetype", "resolutiondate", "updated", "created",
    ];

    const allIssues: JiraAccomplishment[] = [];
    const pageSize = 100;
    const hardLimit = opts?.maxResults || 5000;
    let nextPageToken: string | undefined;

    function mapIssue(issue: any): JiraAccomplishment {
      const f = issue.fields || {};
      return {
        key: issue.key,
        summary: f.summary || issue.key,
        issueType: f.issuetype?.name || "Unknown",
        status: f.status?.name || "Done",
        resolution: f.resolution?.name,
        assignee: f.assignee?.displayName,
        priority: f.priority?.name,
        labels: f.labels || [],
        components: (f.components || []).map((c: any) => c.name),
        resolvedDate: f.resolutiondate,
        updatedDate: f.updated,
        createdDate: f.created,
        url: `${siteUrl}/browse/${issue.key}`,
      };
    }

    while (allIssues.length < hardLimit) {
      const data = await jiraSearchJql(jql, fields, Math.min(pageSize, hardLimit - allIssues.length), nextPageToken);
      const mapped = (data.issues || []).map(mapIssue);
      allIssues.push(...mapped);
      nextPageToken = data.nextPageToken;
      if (!nextPageToken || mapped.length === 0) break;
    }

    return allIssues;
  } catch (err) {
    console.error("Jira fetchAccomplishments failed, falling back to mock:", (err as Error).message);
    return getMockAccomplishments(opts);
  }
}

function getMockAccomplishments(opts?: { startDate?: string; endDate?: string }): JiraAccomplishment[] {
  const mocks: JiraAccomplishment[] = [
    {
      key: "GR-89",
      summary: "Launch unified payment gateway",
      issueType: "Initiative",
      status: "Done",
      resolution: "Done",
      assignee: "Megan",
      priority: "High",
      labels: ["payments", "launch"],
      components: ["Platform"],
      resolvedDate: "2026-01-28T14:30:00.000Z",
      updatedDate: "2026-01-28T14:30:00.000Z",
      createdDate: "2025-09-15T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/GR-89",
    },
    {
      key: "GR-72",
      summary: "Migrate benefit admin to v2 architecture",
      issueType: "Initiative",
      status: "Done",
      resolution: "Done",
      assignee: "Mike",
      priority: "Critical",
      labels: ["migration", "platform"],
      components: ["Benefit Admin"],
      resolvedDate: "2026-01-15T10:00:00.000Z",
      updatedDate: "2026-01-15T10:00:00.000Z",
      createdDate: "2025-08-01T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/GR-72",
    },
    {
      key: "EPIC-250",
      summary: "Self-serve policy exceptions MVP",
      issueType: "Epic",
      status: "Done",
      resolution: "Done",
      assignee: "Dani",
      priority: "Medium",
      labels: ["self-serve"],
      components: ["Growth"],
      resolvedDate: "2026-02-05T16:00:00.000Z",
      updatedDate: "2026-02-05T16:00:00.000Z",
      createdDate: "2025-11-01T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/EPIC-250",
    },
    {
      key: "EPIC-198",
      summary: "Automated compliance reporting dashboard",
      issueType: "Epic",
      status: "Closed",
      resolution: "Fixed",
      assignee: "Laura",
      priority: "High",
      labels: ["compliance", "reporting"],
      components: ["Platform"],
      resolvedDate: "2025-12-20T11:00:00.000Z",
      updatedDate: "2025-12-20T11:00:00.000Z",
      createdDate: "2025-07-15T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/EPIC-198",
    },
    {
      key: "GR-55",
      summary: "Launch member-facing mobile app v1",
      issueType: "Initiative",
      status: "Done",
      resolution: "Done",
      assignee: "Megan",
      priority: "Critical",
      labels: ["mobile", "member-experience"],
      components: ["Growth", "Mobile"],
      resolvedDate: "2025-11-30T15:00:00.000Z",
      updatedDate: "2025-11-30T15:00:00.000Z",
      createdDate: "2025-05-01T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/GR-55",
    },
  ];

  return mocks.filter((m) => {
    if (opts?.startDate && m.resolvedDate && m.resolvedDate < opts.startDate) return false;
    if (opts?.endDate && m.resolvedDate && m.resolvedDate > opts.endDate + "T23:59:59.999Z") return false;
    return true;
  });
}

export interface JiraUpcomingItem {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  assignee?: string;
  priority?: string;
  labels: string[];
  components: string[];
  dueDate?: string;
  startDate?: string;
  updatedDate?: string;
  createdDate?: string;
  url: string;
}

export async function fetchUpcomingDeliverables(opts?: {
  maxResults?: number;
  dueDateFrom?: string;
  dueDateTo?: string;
  createdFrom?: string;
  createdTo?: string;
}): Promise<JiraUpcomingItem[]> {
  if (!isJiraAvailable()) {
    return getMockUpcoming();
  }

  try {
    const { siteUrl } = await getJiraHeaders();

    let jql = `statusCategory != Done AND issuetype in (Initiative, Epic)`;
    if (opts?.dueDateFrom) jql += ` AND duedate >= "${opts.dueDateFrom}"`;
    if (opts?.dueDateTo) jql += ` AND duedate <= "${opts.dueDateTo}"`;
    if (opts?.createdFrom) jql += ` AND created >= "${opts.createdFrom}"`;
    if (opts?.createdTo) jql += ` AND created <= "${opts.createdTo}"`;
    jql += ` ORDER BY priority ASC, updated DESC`;

    const fields = [
      "summary", "status", "assignee", "priority",
      "labels", "components", "issuetype", "duedate", "updated", "created",
    ];

    const allIssues: JiraUpcomingItem[] = [];
    const pageSize = 100;
    const hardLimit = opts?.maxResults || 5000;
    let nextPageToken: string | undefined;

    function mapIssue(issue: any): JiraUpcomingItem {
      const f = issue.fields || {};
      return {
        key: issue.key,
        summary: f.summary || issue.key,
        issueType: f.issuetype?.name || "Unknown",
        status: f.status?.name || "To Do",
        assignee: f.assignee?.displayName,
        priority: f.priority?.name,
        labels: f.labels || [],
        components: (f.components || []).map((c: any) => c.name),
        dueDate: f.duedate,
        updatedDate: f.updated,
        createdDate: f.created,
        url: `${siteUrl}/browse/${issue.key}`,
      };
    }

    while (allIssues.length < hardLimit) {
      const data = await jiraSearchJql(jql, fields, Math.min(pageSize, hardLimit - allIssues.length), nextPageToken);
      const mapped = (data.issues || []).map(mapIssue);
      allIssues.push(...mapped);
      nextPageToken = data.nextPageToken;
      if (!nextPageToken || mapped.length === 0) break;
    }

    return allIssues;
  } catch (err) {
    console.error("Jira fetchUpcomingDeliverables failed, falling back to mock:", (err as Error).message);
    return getMockUpcoming();
  }
}

function getMockUpcoming(): JiraUpcomingItem[] {
  return [
    {
      key: "GR-101",
      summary: "Build payment-agnostic search and discovery",
      issueType: "Initiative",
      status: "In Progress",
      assignee: "Megan",
      priority: "High",
      labels: ["search", "growth"],
      components: ["Growth"],
      dueDate: "2026-06-25",
      updatedDate: "2026-02-15T10:00:00.000Z",
      createdDate: "2025-11-01T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/GR-101",
    },
    {
      key: "GR-142",
      summary: "Build self-serve exceptions management",
      issueType: "Initiative",
      status: "Planned",
      assignee: "Dani",
      priority: "Medium",
      labels: ["platform", "self-serve"],
      components: ["Platform"],
      dueDate: "2026-09-30",
      updatedDate: "2026-02-10T14:00:00.000Z",
      createdDate: "2025-12-01T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/GR-142",
    },
    {
      key: "GR-165",
      summary: "AI-powered benefit recommendation engine",
      issueType: "Initiative",
      status: "In Progress",
      assignee: "Laura",
      priority: "Critical",
      labels: ["ai", "benefits"],
      components: ["Data & AI"],
      dueDate: "2026-05-15",
      updatedDate: "2026-02-14T08:00:00.000Z",
      createdDate: "2026-01-05T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/GR-165",
    },
    {
      key: "EPIC-320",
      summary: "Unified employer dashboard redesign",
      issueType: "Epic",
      status: "In Progress",
      assignee: "Mike",
      priority: "High",
      labels: ["redesign", "employer"],
      components: ["Benefit Admin"],
      dueDate: "2026-04-30",
      updatedDate: "2026-02-12T11:00:00.000Z",
      createdDate: "2025-10-15T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/EPIC-320",
    },
    {
      key: "EPIC-445",
      summary: "Mobile app enrollment flow v2",
      issueType: "Epic",
      status: "To Do",
      assignee: "Megan",
      priority: "Medium",
      labels: ["mobile", "enrollment"],
      components: ["Mobile"],
      dueDate: "2026-07-01",
      updatedDate: "2026-02-08T09:00:00.000Z",
      createdDate: "2026-01-20T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/EPIC-445",
    },
    {
      key: "EPIC-501",
      summary: "Real-time analytics pipeline migration",
      issueType: "Epic",
      status: "In Progress",
      assignee: "Laura",
      priority: "High",
      labels: ["data", "migration"],
      components: ["Platform"],
      dueDate: "2026-03-31",
      updatedDate: "2026-02-16T15:00:00.000Z",
      createdDate: "2025-12-10T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/EPIC-501",
    },
    {
      key: "GR-178",
      summary: "Compliance automation framework",
      issueType: "Initiative",
      status: "Planned",
      assignee: "Dani",
      priority: "Medium",
      labels: ["compliance", "automation"],
      components: ["Platform"],
      dueDate: "2026-08-15",
      updatedDate: "2026-02-01T10:00:00.000Z",
      createdDate: "2026-01-15T09:00:00.000Z",
      url: "https://example.atlassian.net/browse/GR-178",
    },
  ];
}

export async function fetchJiraUsers(query?: string): Promise<JiraUser[]> {
  if (!isJiraAvailable()) {
    return [
      { accountId: "mock-1", displayName: "Megan", active: true },
      { accountId: "mock-2", displayName: "Dani", active: true },
      { accountId: "mock-3", displayName: "Mike", active: true },
      { accountId: "mock-4", displayName: "Laura", active: true },
    ];
  }

  try {
    const data = await jiraSearchJql(
      "assignee IS NOT EMPTY ORDER BY updated DESC",
      ["assignee"],
      100,
    );

    const seen = new Set<string>();
    const users: JiraUser[] = [];
    for (const issue of data.issues || []) {
      const assignee = (issue.fields as any)?.assignee;
      if (!assignee || seen.has(assignee.accountId)) continue;
      seen.add(assignee.accountId);
      const name = assignee.displayName || "";
      if (query && !name.toLowerCase().includes(query.toLowerCase())) continue;
      users.push({
        accountId: assignee.accountId,
        displayName: name,
        emailAddress: assignee.emailAddress,
        avatarUrl: assignee.avatarUrls?.["32x32"],
        active: assignee.active ?? true,
      });
    }
    return users.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch (err) {
    console.error("Jira fetchUsers failed:", (err as Error).message);
    return [];
  }
}

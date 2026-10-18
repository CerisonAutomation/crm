import { getGithubConfig, getGithubSession, githubGet, githubPost, GithubNotConfiguredError } from "@/lib/services/github";

export interface GithubMcpTool { name: string; description: string; inputSchema: Record<string, unknown>; }

const str = (d: string) => ({ type: "string", description: d });
const num = (d: string) => ({ type: "number", description: d });

function notConfigured() { return { configured: false, message: "GitHub connector is not configured - save it in Settings -> Integrations." }; }

async function sessionOrNotConfigured() {
  const config = await getGithubConfig();
  try {
    return { config, session: await getGithubSession(config) };
  } catch (e) {
    if (e instanceof GithubNotConfiguredError) return { config, session: null };
    throw e;
  }
}

export const GITHUB_MCP_TOOLS: GithubMcpTool[] = [
  { name: "github_list_repos", description: "List repositories visible to the authenticated account.", inputSchema: { type: "object", properties: { perPage: num("page size, default 30, max 100"), page: num("1-based page"), org: str("optional organisation to list instead of the user") } } },
  { name: "github_get_repo", description: "Fetch a single repository.", inputSchema: { type: "object", properties: { owner: str("repository owner"), repo: str("repository name") }, required: ["owner", "repo"] } },
  { name: "github_list_issues", description: "List issues on a repository.", inputSchema: { type: "object", properties: { owner: str("repository owner"), repo: str("repository name"), state: str("open, closed or all (default open)"), perPage: num("page size, default 30") }, required: ["owner", "repo"] } },
  { name: "github_get_issue", description: "Fetch a single issue.", inputSchema: { type: "object", properties: { owner: str("repository owner"), repo: str("repository name"), issueNumber: num("issue number") }, required: ["owner", "repo", "issueNumber"] } },
  { name: "github_create_issue", description: "Create an issue on a repository.", inputSchema: { type: "object", properties: { owner: str("repository owner"), repo: str("repository name"), title: str("issue title"), body: str("issue body (markdown)"), labels: { type: "array", items: { type: "string" }, description: "optional labels" } }, required: ["owner", "repo", "title"] } },
  { name: "github_list_pull_requests", description: "List pull requests on a repository.", inputSchema: { type: "object", properties: { owner: str("repository owner"), repo: str("repository name"), state: str("open, closed or all (default open)"), perPage: num("page size, default 30") }, required: ["owner", "repo"] } },
  { name: "github_get_pull_request", description: "Fetch a single pull request.", inputSchema: { type: "object", properties: { owner: str("repository owner"), repo: str("repository name"), prNumber: num("pull request number") }, required: ["owner", "repo", "prNumber"] } },
  { name: "github_create_pull_request", description: "Create a pull request.", inputSchema: { type: "object", properties: { owner: str("repository owner"), repo: str("repository name"), title: str("PR title"), head: str("head branch or user:branch"), base: str("base branch"), body: str("PR body (markdown)"), draft: { type: "boolean", description: "create as draft" } }, required: ["owner", "repo", "title", "head", "base"] } },
  { name: "github_list_commits", description: "List commits on a repository or branch.", inputSchema: { type: "object", properties: { owner: str("repository owner"), repo: str("repository name"), sha: str("branch or commit SHA (optional)"), perPage: num("page size, default 30") }, required: ["owner", "repo"] } },
  { name: "github_get_file_contents", description: "Fetch the contents of a file from a repository.", inputSchema: { type: "object", properties: { owner: str("repository owner"), repo: str("repository name"), path: str("file path"), ref: str("git ref (branch/tag/SHA), optional") }, required: ["owner", "repo", "path"] } },
  { name: "github_search_repositories", description: "Search GitHub repositories.", inputSchema: { type: "object", properties: { q: str("search query"), perPage: num("page size, default 20") }, required: ["q"] } },
];

export async function callGithubTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { session } = await sessionOrNotConfigured();
  if (!session) return notConfigured();
  const owner = (args.owner ?? "").toString();
  const repo = (args.repo ?? "").toString();
  const repoPath = "/repos/" + owner + "/" + repo;
  switch (name) {
    case "github_list_repos": {
      const org = (args.org ?? "").toString().trim();
      const perPage = Math.min(100, Math.max(1, Number(args.perPage ?? 30)));
      const page = Math.max(1, Number(args.page ?? 1));
      const path = org ? "/orgs/" + encodeURIComponent(org) + "/repos?per_page=" + perPage + "&page=" + page
        : "/user/repos?per_page=" + perPage + "&page=" + page + "&sort=updated";
      return { repositories: await githubGet<any[]>(path, session) };
    }
    case "github_get_repo": {
      return await githubGet(repoPath, session);
    }
    case "github_list_issues": {
      const state = (args.state ?? "open").toString();
      const perPage = Math.min(100, Math.max(1, Number(args.perPage ?? 30)));
      const path = repoPath + "/issues?state=" + encodeURIComponent(state) + "&per_page=" + perPage + "&sort=updated";
      return { issues: await githubGet<any[]>(path, session) };
    }
    case "github_get_issue": {
      return await githubGet(repoPath + "/issues/" + Number(args.issueNumber), session);
    }
    case "github_create_issue": {
      const payload: Record<string, unknown> = { title: String(args.title ?? "") };
      if (args.body !== undefined) payload.body = String(args.body);
      if (Array.isArray(args.labels)) payload.labels = args.labels;
      return await githubPost(repoPath + "/issues", session, payload);
    }
    case "github_list_pull_requests": {
      const state = (args.state ?? "open").toString();
      const perPage = Math.min(100, Math.max(1, Number(args.perPage ?? 30)));
      const path = repoPath + "/pulls?state=" + encodeURIComponent(state) + "&per_page=" + perPage + "&sort=updated";
      return { pull_requests: await githubGet<any[]>(path, session) };
    }
    case "github_get_pull_request": {
      return await githubGet(repoPath + "/pulls/" + Number(args.prNumber), session);
    }
    case "github_create_pull_request": {
      const payload: Record<string, unknown> = {
        title: String(args.title ?? ""),
        head: String(args.head ?? ""),
        base: String(args.base ?? ""),
      };
      if (args.body !== undefined) payload.body = String(args.body);
      if (args.draft !== undefined) payload.draft = Boolean(args.draft);
      return await githubPost(repoPath + "/pulls", session, payload);
    }
    case "github_list_commits": {
      const perPage = Math.min(100, Math.max(1, Number(args.perPage ?? 30)));
      let path = repoPath + "/commits?per_page=" + perPage;
      if (args.sha) path += "&sha=" + encodeURIComponent(String(args.sha));
      return { commits: await githubGet<any[]>(path, session) };
    }
    case "github_get_file_contents": {
      const p = String(args.path ?? "").replace(/^\//, "");
      let path = repoPath + "/contents/" + encodeURIComponent(p).replace(/%2F/g, "/");
      const qs: string[] = [];
      if (args.ref) qs.push("ref=" + encodeURIComponent(String(args.ref)));
      if (qs.length) path += "?" + qs.join("&");
      return await githubGet(path, session);
    }
    case "github_search_repositories": {
      const perPage = Math.min(100, Math.max(1, Number(args.perPage ?? 20)));
      const path = "/search/repositories?q=" + encodeURIComponent(String(args.q ?? "")) + "&per_page=" + perPage;
      return await githubGet(path, session);
    }
    default:
      throw new Error("Unknown github tool: " + name);
  }
}

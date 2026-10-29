use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tracing::{error, info};

/// Represents an issue created on an external provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalIssue {
    pub id: String,
    pub key: String,
    pub url: String,
    pub status: Option<String>,
}

/// Escape Markdown-significant characters so user-supplied text is embedded
/// as literal content rather than formatting. Intentionally limited to a safe
/// subset of characters commonly used for markdown injection.
fn markdown_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' | '[' | ']' | '(' | ')' | '#' | '!' | '`' | '*' | '_' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

/// Strip ASCII control characters (\x00-\x1F) except newline and tab, and
/// cap the resulting string at `max_bytes` UTF-8 bytes without splitting a
/// multi-byte character.
fn sanitize_for_adf(s: &str) -> String {
    let mut cleaned = String::with_capacity(s.len());
    for ch in s.chars() {
        let c = ch as u32;
        if c < 0x20 && ch != '\n' && ch != '\t' {
            continue;
        }
        cleaned.push(ch);
    }
    const MAX_BYTES: usize = 30_000;
    if cleaned.len() <= MAX_BYTES {
        return cleaned;
    }
    let mut end = MAX_BYTES;
    while end > 0 && !cleaned.is_char_boundary(end) {
        end -= 1;
    }
    cleaned.truncate(end);
    cleaned
}

/// Format a Bugwatch issue body for external issue trackers (Markdown)
pub fn format_issue_body(
    title: &str,
    issue_id: &str,
    event_url: &str,
    extra_context: Option<&str>,
) -> String {
    let safe_title = markdown_escape(title);
    let safe_issue_id = markdown_escape(issue_id);
    let mut body = format!(
        "## Bugwatch Issue\n\n**Title:** {}\n**Issue ID:** {}\n\n[View in Bugwatch]({})\n",
        safe_title, safe_issue_id, event_url
    );
    if let Some(ctx) = extra_context {
        body.push_str(&format!(
            "\n### Additional Context\n\n{}\n",
            markdown_escape(ctx)
        ));
    }
    body.push_str("\n---\n*Created by [Bugwatch](https://bugwatch.dev)*\n");
    body
}

// ============================================================================
// GitHub Service
// ============================================================================

pub struct GitHubService;

impl GitHubService {
    /// Create an issue on GitHub
    pub async fn create_issue(
        token: &str,
        owner: &str,
        repo: &str,
        title: &str,
        body: &str,
    ) -> Result<ExternalIssue> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;
        let url = format!("https://api.github.com/repos/{}/{}/issues", owner, repo);

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Bugwatch")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&serde_json::json!({
                "title": title,
                "body": body,
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            error!("GitHub API error: {} - {}", status, text);
            return Err(anyhow!("GitHub API error: {} - {}", status, text));
        }

        let data: serde_json::Value = response.json().await?;
        let number = data["number"].as_i64().unwrap_or(0);
        let html_url = data["html_url"].as_str().unwrap_or("").to_string();
        let id = data["id"].as_i64().unwrap_or(0).to_string();

        info!("Created GitHub issue #{} in {}/{}", number, owner, repo);

        Ok(ExternalIssue {
            id,
            key: format!("{}#{}", repo, number),
            url: html_url,
            status: Some("open".to_string()),
        })
    }

    /// Get the authenticated user's info
    pub async fn get_user(token: &str) -> Result<(String, String)> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;
        let response = client
            .get("https://api.github.com/user")
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Bugwatch")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow!("Failed to get GitHub user info"));
        }

        let data: serde_json::Value = response.json().await?;
        let id = data["id"].as_i64().unwrap_or(0).to_string();
        let login = data["login"].as_str().unwrap_or("unknown").to_string();
        Ok((id, login))
    }

    /// Exchange OAuth code for access token
    pub async fn exchange_code(
        client_id: &str,
        client_secret: &str,
        code: &str,
    ) -> Result<(String, Option<String>)> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;
        let response = client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .json(&serde_json::json!({
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
            }))
            .send()
            .await?;

        let data: serde_json::Value = response.json().await?;

        if let Some(error) = data["error"].as_str() {
            return Err(anyhow!("GitHub OAuth error: {}", error));
        }

        let access_token = data["access_token"]
            .as_str()
            .ok_or_else(|| anyhow!("No access token in response"))?
            .to_string();
        let refresh_token = data["refresh_token"].as_str().map(|s| s.to_string());

        Ok((access_token, refresh_token))
    }
}

// ============================================================================
// Jira Service
// ============================================================================

pub struct JiraService;

impl JiraService {
    /// Create an issue on Jira
    pub async fn create_issue(
        token: &str,
        cloud_id: &str,
        project_key: &str,
        title: &str,
        body: &str,
    ) -> Result<ExternalIssue> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;
        let url = format!(
            "https://api.atlassian.com/ex/jira/{}/rest/api/3/issue",
            cloud_id
        );

        // Convert markdown body to Jira ADF format (simplified).
        // Always wrap user-supplied content as a single plain "text" node so
        // an attacker cannot inject arbitrary ADF structure via keywords like
        // `{"type":"..."`. Control chars are stripped and the body is capped.
        let safe_body = sanitize_for_adf(body);
        let adf_body = serde_json::json!({
            "type": "doc",
            "version": 1,
            "content": [{
                "type": "paragraph",
                "content": [{
                    "type": "text",
                    "text": safe_body
                }]
            }]
        });

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "fields": {
                    "project": { "key": project_key },
                    "summary": title,
                    "description": adf_body,
                    "issuetype": { "name": "Bug" }
                }
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            error!("Jira API error: {} - {}", status, text);
            return Err(anyhow!("Jira API error: {} - {}", status, text));
        }

        let data: serde_json::Value = response.json().await?;
        let id = data["id"].as_str().unwrap_or("").to_string();
        let key = data["key"].as_str().unwrap_or("").to_string();
        let browse_url = format!(
            "https://api.atlassian.com/ex/jira/{}/browse/{}",
            cloud_id, key
        );

        info!("Created Jira issue {} in project {}", key, project_key);

        Ok(ExternalIssue {
            id,
            key,
            url: browse_url,
            status: Some("To Do".to_string()),
        })
    }

    /// Exchange OAuth code for access token
    pub async fn exchange_code(
        client_id: &str,
        client_secret: &str,
        code: &str,
        redirect_uri: &str,
    ) -> Result<(String, Option<String>, Option<String>)> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;
        let response = client
            .post("https://auth.atlassian.com/oauth/token")
            .json(&serde_json::json!({
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow!("Jira OAuth error: {}", text));
        }

        let data: serde_json::Value = response.json().await?;
        let access_token = data["access_token"]
            .as_str()
            .ok_or_else(|| anyhow!("No access token"))?
            .to_string();
        let refresh_token = data["refresh_token"].as_str().map(|s| s.to_string());

        // Get the cloud ID for API calls
        let cloud_id = Self::get_cloud_id(&access_token).await.ok();

        Ok((access_token, refresh_token, cloud_id))
    }

    /// Get the Jira cloud ID for the authenticated user
    async fn get_cloud_id(token: &str) -> Result<String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;
        let response = client
            .get("https://api.atlassian.com/oauth/token/accessible-resources")
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Failed to get Jira cloud ID: {}", text));
        }

        let data: Vec<serde_json::Value> = response.json().await?;
        data.first()
            .and_then(|r| r["id"].as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("No accessible Jira resources"))
    }

    /// Get the authenticated user info
    pub async fn get_user(token: &str) -> Result<(String, String)> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;
        let response = client
            .get("https://api.atlassian.com/me")
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow!("Failed to get Jira user info"));
        }

        let data: serde_json::Value = response.json().await?;
        let id = data["account_id"].as_str().unwrap_or("unknown").to_string();
        let name = data["name"].as_str().unwrap_or("unknown").to_string();
        Ok((id, name))
    }
}

// ============================================================================
// Linear Service
// ============================================================================

pub struct LinearService;

impl LinearService {
    /// Create an issue on Linear
    pub async fn create_issue(
        token: &str,
        team_id: &str,
        title: &str,
        body: &str,
    ) -> Result<ExternalIssue> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;

        let query = r#"
            mutation IssueCreate($input: IssueCreateInput!) {
                issueCreate(input: $input) {
                    success
                    issue {
                        id
                        identifier
                        url
                        state {
                            name
                        }
                    }
                }
            }
        "#;

        let response = client
            .post("https://api.linear.app/graphql")
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "query": query,
                "variables": {
                    "input": {
                        "teamId": team_id,
                        "title": title,
                        "description": body,
                    }
                }
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            error!("Linear API error: {} - {}", status, text);
            return Err(anyhow!("Linear API error: {} - {}", status, text));
        }

        let data: serde_json::Value = response.json().await?;
        let issue_data = &data["data"]["issueCreate"]["issue"];

        if issue_data.is_null() {
            let errors = &data["errors"];
            return Err(anyhow!("Linear API error: {}", errors));
        }

        let id = issue_data["id"].as_str().unwrap_or("").to_string();
        let identifier = issue_data["identifier"].as_str().unwrap_or("").to_string();
        let url = issue_data["url"].as_str().unwrap_or("").to_string();
        let status = issue_data["state"]["name"].as_str().map(|s| s.to_string());

        info!("Created Linear issue {}", identifier);

        Ok(ExternalIssue {
            id,
            key: identifier,
            url,
            status,
        })
    }

    /// Exchange OAuth code for access token
    pub async fn exchange_code(
        client_id: &str,
        client_secret: &str,
        code: &str,
        redirect_uri: &str,
    ) -> Result<String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;
        let response = client
            .post("https://api.linear.app/oauth/token")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("code", code),
                ("redirect_uri", redirect_uri),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow!("Linear OAuth error: {}", text));
        }

        let data: serde_json::Value = response.json().await?;
        data["access_token"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("No access token in Linear response"))
    }

    /// Get authenticated user info via GraphQL
    pub async fn get_user(token: &str) -> Result<(String, String)> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create HTTP client: {}", e))?;
        let response = client
            .post("https://api.linear.app/graphql")
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "query": "{ viewer { id name email } }"
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Failed to get Linear user: {}", text));
        }

        let data: serde_json::Value = response.json().await?;
        let viewer = &data["data"]["viewer"];
        let id = viewer["id"].as_str().unwrap_or("unknown").to_string();
        let name = viewer["name"].as_str().unwrap_or("unknown").to_string();
        Ok((id, name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── markdown_escape ──────────────────────────────────────────────────────

    #[test]
    fn markdown_escape_plain_text_unchanged() {
        assert_eq!(markdown_escape("hello world"), "hello world");
    }

    #[test]
    fn markdown_escape_empty_string() {
        assert_eq!(markdown_escape(""), "");
    }

    #[test]
    fn markdown_escape_special_chars() {
        let special = r#"#[]()*_`!\<"#;
        let escaped = markdown_escape(special);
        // Every special char should be preceded by backslash
        assert!(escaped.contains("\\#"));
        assert!(escaped.contains("\\["));
        assert!(escaped.contains("\\]"));
        assert!(escaped.contains("\\("));
        assert!(escaped.contains("\\)"));
        assert!(escaped.contains("\\*"));
        assert!(escaped.contains("\\_"));
        assert!(escaped.contains("\\`"));
        assert!(escaped.contains("\\!"));
    }

    #[test]
    fn markdown_escape_backslash() {
        assert_eq!(markdown_escape("\\"), "\\\\");
    }

    // ── sanitize_for_adf ─────────────────────────────────────────────────────

    #[test]
    fn sanitize_for_adf_passes_normal_text() {
        let s = "Hello World";
        assert_eq!(sanitize_for_adf(s), s);
    }

    #[test]
    fn sanitize_for_adf_preserves_newline_and_tab() {
        let s = "line1\nline2\ttab";
        assert_eq!(sanitize_for_adf(s), s);
    }

    #[test]
    fn sanitize_for_adf_removes_control_chars() {
        let result = sanitize_for_adf("Hello\x00World\x01\x1FEnd");
        assert_eq!(result, "HelloWorldEnd");
    }

    #[test]
    fn sanitize_for_adf_truncates_at_30000_bytes() {
        let long = "a".repeat(40_000);
        let result = sanitize_for_adf(&long);
        assert_eq!(result.len(), 30_000);
    }

    #[test]
    fn sanitize_for_adf_short_string_not_truncated() {
        let s = "short";
        assert_eq!(sanitize_for_adf(s), s);
    }

    // ── format_issue_body ─────────────────────────────────────────────────────

    #[test]
    fn format_issue_body_contains_required_fields() {
        let body = format_issue_body("Test Error", "iss-123", "https://bugwatch.dev/1", None);
        assert!(body.contains("Test Error"));
        assert!(body.contains("iss-123"));
        assert!(body.contains("https://bugwatch.dev/1"));
        assert!(body.contains("Bugwatch Issue"));
        assert!(body.contains("View in Bugwatch"));
    }

    #[test]
    fn format_issue_body_with_extra_context() {
        let body = format_issue_body("Err", "i1", "https://x.com", Some("Extra context here"));
        assert!(body.contains("Additional Context"));
        assert!(body.contains("Extra context here"));
    }

    #[test]
    fn format_issue_body_without_extra_context_no_section() {
        let body = format_issue_body("Err", "i1", "https://x.com", None);
        assert!(!body.contains("Additional Context"));
    }

    #[test]
    fn format_issue_body_escapes_markdown_in_title() {
        let body = format_issue_body("[critical] Error", "i1", "https://x.com", None);
        assert!(body.contains("\\[critical\\]"));
    }
}

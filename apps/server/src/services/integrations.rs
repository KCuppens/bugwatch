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

/// Format a Bugwatch issue body for external issue trackers (Markdown)
pub fn format_issue_body(
    title: &str,
    issue_id: &str,
    event_url: &str,
    extra_context: Option<&str>,
) -> String {
    let mut body = format!(
        "## Bugwatch Issue\n\n**Title:** {}\n**Issue ID:** {}\n\n[View in Bugwatch]({})\n",
        title, issue_id, event_url
    );
    if let Some(ctx) = extra_context {
        body.push_str(&format!("\n### Additional Context\n\n{}\n", ctx));
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

        // Convert markdown body to Jira ADF format (simplified)
        let adf_body = serde_json::json!({
            "type": "doc",
            "version": 1,
            "content": [{
                "type": "paragraph",
                "content": [{
                    "type": "text",
                    "text": body
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

        let data: serde_json::Value = response.json().await?;
        let viewer = &data["data"]["viewer"];
        let id = viewer["id"].as_str().unwrap_or("unknown").to_string();
        let name = viewer["name"].as_str().unwrap_or("unknown").to_string();
        Ok((id, name))
    }
}

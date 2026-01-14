use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MODEL: &str = "claude-sonnet-4-20250514";

/// AI Service for generating fix suggestions using Anthropic Claude
#[derive(Clone)]
pub struct AiService {
    client: Client,
    api_key: String,
}

/// Request to Anthropic Messages API
#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
    system: String,
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: String,
}

/// Response from Anthropic Messages API
#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<ContentBlock>,
    #[allow(dead_code)]
    usage: Usage,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Usage {
    #[allow(dead_code)]
    input_tokens: u32,
    #[allow(dead_code)]
    output_tokens: u32,
}

/// Error context for AI fix generation
#[derive(Debug, Clone)]
pub struct ErrorContext {
    pub error_type: String,
    pub error_message: String,
    pub stack_trace: Vec<StackFrame>,
    pub environment: Option<String>,
    pub runtime: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StackFrame {
    pub filename: String,
    pub function: String,
    pub lineno: u32,
    pub colno: u32,
    pub context_line: Option<String>,
    pub pre_context: Option<Vec<String>>,
    pub post_context: Option<Vec<String>>,
    pub in_app: bool,
}

/// AI-generated fix suggestion
#[derive(Debug, Clone, Serialize)]
pub struct AiFix {
    /// Brief explanation of the issue
    pub explanation: String,
    /// Suggested fix as code
    pub fix_code: String,
    /// Additional recommendations
    pub recommendations: Vec<String>,
    /// Confidence level (0.0 to 1.0)
    pub confidence: f32,
}

impl AiService {
    pub fn new(api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
        }
    }

    /// Generate a fix suggestion for the given error
    pub async fn generate_fix(&self, context: ErrorContext) -> Result<AiFix> {
        let prompt = self.build_prompt(&context);
        let response = self.call_anthropic(&prompt).await?;
        self.parse_response(&response)
    }

    fn build_prompt(&self, context: &ErrorContext) -> String {
        let mut prompt = format!(
            "Error Type: {}\nError Message: {}\n\n",
            context.error_type, context.error_message
        );

        if let Some(env) = &context.environment {
            prompt.push_str(&format!("Environment: {}\n", env));
        }

        if let Some(runtime) = &context.runtime {
            prompt.push_str(&format!("Runtime: {}\n", runtime));
        }

        prompt.push_str("\nStack Trace:\n");

        for (i, frame) in context.stack_trace.iter().enumerate() {
            let in_app_marker = if frame.in_app { " [in-app]" } else { "" };
            prompt.push_str(&format!(
                "{}. {} at {}:{}:{}{}\n",
                i + 1,
                frame.function,
                frame.filename,
                frame.lineno,
                frame.colno,
                in_app_marker
            ));

            if let Some(context_line) = &frame.context_line {
                if let Some(pre) = &frame.pre_context {
                    for line in pre {
                        prompt.push_str(&format!("   {}\n", line));
                    }
                }
                prompt.push_str(&format!(">> {}\n", context_line));
                if let Some(post) = &frame.post_context {
                    for line in post {
                        prompt.push_str(&format!("   {}\n", line));
                    }
                }
            }
            prompt.push('\n');
        }

        prompt
    }

    async fn call_anthropic(&self, user_prompt: &str) -> Result<String> {
        let system_prompt = r#"You are an expert software engineer specializing in debugging and fixing errors.
Analyze the provided error and stack trace, then provide a fix suggestion.

Your response MUST be in the following JSON format:
{
  "explanation": "Brief explanation of what caused the error",
  "fix_code": "The corrected code snippet that fixes the issue",
  "recommendations": ["Additional recommendation 1", "Additional recommendation 2"],
  "confidence": 0.85
}

Guidelines:
1. Focus on the root cause, not just symptoms
2. The fix_code should be a complete, working code snippet
3. Include defensive coding practices in your fix
4. Consider edge cases that might have caused the issue
5. Set confidence between 0.0 and 1.0 based on how certain you are about the fix
6. Keep explanations concise but informative"#;

        let request = AnthropicRequest {
            model: MODEL.to_string(),
            max_tokens: 2048,
            messages: vec![Message {
                role: "user".to_string(),
                content: user_prompt.to_string(),
            }],
            system: system_prompt.to_string(),
        };

        let response = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "Anthropic API error: {} - {}",
                status,
                error_text
            ));
        }

        let anthropic_response: AnthropicResponse = response.json().await?;

        // Extract text from response
        let text = anthropic_response
            .content
            .iter()
            .find(|c| c.content_type == "text")
            .and_then(|c| c.text.clone())
            .ok_or_else(|| anyhow!("No text content in response"))?;

        Ok(text)
    }

    fn parse_response(&self, response: &str) -> Result<AiFix> {
        // Try to extract JSON from the response
        // Sometimes Claude includes markdown code blocks
        let json_str = if response.contains("```json") {
            response
                .split("```json")
                .nth(1)
                .and_then(|s| s.split("```").next())
                .unwrap_or(response)
                .trim()
        } else if response.contains("```") {
            response
                .split("```")
                .nth(1)
                .unwrap_or(response)
                .trim()
        } else {
            response.trim()
        };

        #[derive(Deserialize)]
        struct FixResponse {
            explanation: String,
            fix_code: String,
            recommendations: Vec<String>,
            confidence: f32,
        }

        let parsed: FixResponse = serde_json::from_str(json_str).map_err(|e| {
            anyhow!("Failed to parse AI response: {}. Response: {}", e, json_str)
        })?;

        Ok(AiFix {
            explanation: parsed.explanation,
            fix_code: parsed.fix_code,
            recommendations: parsed.recommendations,
            confidence: parsed.confidence.clamp(0.0, 1.0),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_response() {
        let service = AiService::new("test".to_string());

        let response = r#"{
            "explanation": "The error occurs because users is undefined",
            "fix_code": "const users = data?.users ?? [];",
            "recommendations": ["Add null checks", "Use optional chaining"],
            "confidence": 0.9
        }"#;

        let fix = service.parse_response(response).unwrap();
        assert_eq!(fix.explanation, "The error occurs because users is undefined");
        assert_eq!(fix.confidence, 0.9);
    }

    #[test]
    fn test_parse_response_with_markdown() {
        let service = AiService::new("test".to_string());

        let response = r#"Here's my analysis:

```json
{
    "explanation": "Test",
    "fix_code": "const x = 1;",
    "recommendations": [],
    "confidence": 0.8
}
```"#;

        let fix = service.parse_response(response).unwrap();
        assert_eq!(fix.explanation, "Test");
    }
}

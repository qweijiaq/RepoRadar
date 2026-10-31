// 由 x-code 的 provider catalog 生成，保持模型清单一致。请勿手改。
import type { LlmProviderInfo } from './providers.js'

export const LLM_PROVIDER_DATA: LlmProviderInfo[] = [
  {
    "id": "anthropic",
    "name": "Anthropic",
    "envKey": "ANTHROPIC_API_KEY",
    "keyUrl": "https://console.anthropic.com/",
    "protocol": "anthropic",
    "baseUrl": "https://api.anthropic.com",
    "defaultModel": "claude-sonnet-5",
    "models": [
      {
        "id": "claude-fable-5-1",
        "label": "Fable 5.1"
      },
      {
        "id": "claude-opus-5",
        "label": "Opus 5"
      },
      {
        "id": "claude-fable-5",
        "label": "Fable 5"
      },
      {
        "id": "claude-opus-4-8",
        "label": "Opus 4.8"
      },
      {
        "id": "claude-sonnet-5",
        "label": "Sonnet 5"
      },
      {
        "id": "claude-haiku-4-5",
        "label": "Haiku 4.5"
      }
    ]
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "envKey": "OPENAI_API_KEY",
    "keyUrl": "https://platform.openai.com/api-keys",
    "protocol": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "defaultModel": "gpt-5.6-sol",
    "models": [
      {
        "id": "gpt-6-astra",
        "label": "GPT-6 Astra"
      },
      {
        "id": "gpt-5.6-sol",
        "label": "GPT-5.6 Sol"
      },
      {
        "id": "gpt-5.6-terra",
        "label": "GPT-5.6 Terra"
      },
      {
        "id": "gpt-5.6-luna",
        "label": "GPT-5.6 Luna"
      },
      {
        "id": "gpt-5.4-mini",
        "label": "GPT-5.4 Mini"
      },
      {
        "id": "gpt-5.4-nano",
        "label": "GPT-5.4 Nano"
      }
    ]
  },
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "envKey": "DEEPSEEK_API_KEY",
    "keyUrl": "https://platform.deepseek.com/api_keys",
    "protocol": "openai",
    "baseUrl": "https://api.deepseek.com/v1",
    "defaultModel": "deepseek-flash",
    "models": [
      {
        "id": "deepseek-flash",
        "label": "DeepSeek V4.1 Flash"
      },
      {
        "id": "deepseek-v4-pro",
        "label": "DeepSeek V4 Pro"
      }
    ]
  },
  {
    "id": "alibaba",
    "name": "阿里云百炼（Qwen）",
    "envKey": "ALIBABA_API_KEY",
    "keyUrl": "https://dashscope.console.aliyun.com/apiKey",
    "protocol": "openai",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "defaultModel": "qwen3.8-max",
    "models": [
      {
        "id": "qwen3.8-max",
        "label": "Qwen3.8 Max"
      },
      {
        "id": "qwen3.8-flash",
        "label": "Qwen3.8 Flash"
      },
      {
        "id": "qwen3.7-max",
        "label": "Qwen3.7 Max"
      },
      {
        "id": "qwen3.7-plus",
        "label": "Qwen3.7 Plus"
      },
      {
        "id": "qwen3.7-flash",
        "label": "Qwen3.7 Flash"
      },
      {
        "id": "qwen3-coder-plus",
        "label": "Qwen3 Coder Plus"
      },
      {
        "id": "qwq-plus",
        "label": "QwQ Plus"
      },
      {
        "id": "qwen3-vl-plus",
        "label": "Qwen3-VL Plus"
      },
      {
        "id": "qwen3-vl-flash",
        "label": "Qwen3-VL Flash"
      }
    ]
  },
  {
    "id": "google",
    "name": "Google Gemini",
    "envKey": "GOOGLE_GENERATIVE_AI_API_KEY",
    "keyUrl": "https://aistudio.google.com/apikey",
    "protocol": "openai",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
    "defaultModel": "gemini-3.8-flash",
    "models": [
      {
        "id": "gemini-3.8-flash",
        "label": "Gemini 3.8 Flash"
      },
      {
        "id": "gemini-3.7-flash",
        "label": "Gemini 3.7 Flash"
      },
      {
        "id": "gemini-3.6-flash",
        "label": "Gemini 3.6 Flash"
      },
      {
        "id": "gemini-3.5-flash",
        "label": "Gemini 3.5 Flash"
      },
      {
        "id": "gemini-2.5-pro",
        "label": "Gemini 2.5 Pro"
      },
      {
        "id": "gemini-2.5-flash",
        "label": "Gemini 2.5 Flash"
      }
    ]
  },
  {
    "id": "xai",
    "name": "xAI（Grok）",
    "envKey": "XAI_API_KEY",
    "keyUrl": "https://console.x.ai/",
    "protocol": "openai",
    "baseUrl": "https://api.x.ai/v1",
    "defaultModel": "grok-4.6",
    "models": [
      {
        "id": "grok-4.6",
        "label": "Grok 4.6"
      },
      {
        "id": "grok-4.20",
        "label": "Grok 4.20"
      },
      {
        "id": "grok-4.20-non-reasoning",
        "label": "Grok 4.20 Non-Reasoning"
      },
      {
        "id": "grok-4.5",
        "label": "Grok 4.5"
      },
      {
        "id": "grok-4.3",
        "label": "Grok 4.3"
      }
    ]
  },
  {
    "id": "zhipu",
    "name": "智谱 GLM",
    "envKey": "ZHIPU_API_KEY",
    "keyUrl": "https://open.bigmodel.cn/usercenter/apikeys",
    "protocol": "openai",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
    "defaultModel": "glm-5.3",
    "models": [
      {
        "id": "glm-5.3",
        "label": "GLM-5.3"
      },
      {
        "id": "glm-5.3-flash",
        "label": "GLM-5.3 Flash"
      },
      {
        "id": "glm-5.2",
        "label": "GLM-5.2"
      },
      {
        "id": "glm-5",
        "label": "GLM-5"
      },
      {
        "id": "glm-4.7",
        "label": "GLM-4.7"
      },
      {
        "id": "glm-5v-turbo",
        "label": "GLM-5V Turbo"
      },
      {
        "id": "glm-4.6v",
        "label": "GLM-4.6V"
      }
    ]
  },
  {
    "id": "moonshotai",
    "name": "Moonshot（Kimi）",
    "envKey": "MOONSHOT_API_KEY",
    "keyUrl": "https://platform.moonshot.ai/console/api-keys",
    "protocol": "openai",
    "baseUrl": "https://api.moonshot.cn/v1",
    "defaultModel": "kimi-k3",
    "models": [
      {
        "id": "kimi-k3",
        "label": "Kimi K3"
      },
      {
        "id": "kimi-k2.7-code",
        "label": "Kimi K2.7 Code"
      },
      {
        "id": "kimi-k2.7-code-highspeed",
        "label": "Kimi K2.7 Code Highspeed"
      },
      {
        "id": "kimi-k2.6",
        "label": "Kimi K2.6"
      }
    ],
    "baseUrlOptions": [
      {
        "label": "api.kimi.com/coding (Coding Plan)",
        "url": "https://api.kimi.com/coding/v1"
      },
      {
        "label": "api.moonshot.cn (China)",
        "url": "https://api.moonshot.cn/v1"
      },
      {
        "label": "api.moonshot.ai (International)",
        "url": "https://api.moonshot.ai/v1"
      }
    ]
  }
]

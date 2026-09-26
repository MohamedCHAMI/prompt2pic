const TOOLS = [
  {
    name: 'configure_api_key',
    description: 'Set or update the Gemini API key for image generation. The key is stored locally and persists across sessions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        apiKey: {
          type: 'string',
          description: 'Your Google Gemini API key (get one at https://aistudio.google.com/apikey)',
        },
      },
      required: ['apiKey'],
    },
  },
  {
    name: 'configure_google_login',
    description:
      'Switch to the free, unofficial "gemini-web" auth mode that uses your logged-in consumer Gemini (gemini.google.com) session instead of an API key. Supports image generation and editing (no video). Extract the cookies from your browser DevTools (Application > Cookies > gemini.google.com). Cookies are stored locally and may need re-extraction when they expire.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        secure1psid: {
          type: 'string',
          description: 'The __Secure-1PSID cookie value from gemini.google.com (required)',
        },
        secure1psidts: {
          type: 'string',
          description: 'The __Secure-1PSIDTS cookie value (recommended; improves session stability)',
        },
      },
      required: ['secure1psid'],
    },
  },
  {
    name: 'configure_model',
    description:
      'Set the default Gemini model for image generation and editing. Persists across sessions. Use "quality" param to set either "high" (default) or "fast" model tier. High-quality: gemini-3.1-flash-image-preview (default). Fast/cheap: gemini-2.5-flash-image (default fast).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: {
          type: 'string',
          description: 'Gemini model ID to use',
        },
        quality: {
          type: 'string',
          enum: ['high', 'fast'],
          description: 'Which model tier to set: "high" (default, best quality) or "fast" (cheaper/faster). Defaults to "high".',
        },
      },
      required: ['model'],
    },
  },
  {
    name: 'generate_image',
    description: 'Generate a new image from a text description using Gemini AI. Returns the generated image and saves it to disk.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate',
        },
        model: {
          type: 'string',
          description: 'Optional model override for this request',
        },
        quality: {
          type: 'string',
          enum: ['high', 'fast'],
          description: 'Model tier: "high" (best quality, default) or "fast" (cheaper/faster)',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'edit_image',
    description: 'Edit an existing image based on text instructions. Provide the file path of the image to modify.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        imagePath: {
          type: 'string',
          description: 'Absolute file path to the image to edit',
        },
        prompt: {
          type: 'string',
          description: 'Instructions for how to edit the image',
        },
        referenceImages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of file paths to reference images for style or content guidance',
        },
        model: {
          type: 'string',
          description: 'Optional model override for this request',
        },
        quality: {
          type: 'string',
          enum: ['high', 'fast'],
          description: 'Model tier: "high" (best quality, default) or "fast" (cheaper/faster)',
        },
      },
      required: ['imagePath', 'prompt'],
    },
  },
  {
    name: 'continue_editing',
    description: 'Continue editing the last generated or edited image. Automatically uses the most recent image from the session.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'Instructions for the next edit',
        },
        referenceImages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reference images for guidance',
        },
        model: {
          type: 'string',
          description: 'Optional model override for this request',
        },
        quality: {
          type: 'string',
          enum: ['high', 'fast'],
          description: 'Model tier: "high" (best quality, default) or "fast" (cheaper/faster)',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description:
      'Generate a video from a text prompt using Gemini Veo. Supports text-to-video, image-to-video (first frame), and first+last frame interpolation. Video generation takes 1-6 minutes. Available models: veo-3.1-generate-preview (latest), veo-3-generate-preview, veo-2-generate-preview.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the video to generate. Include subject, action, style, camera movement, and atmosphere.',
        },
        model: {
          type: 'string',
          description:
            'Veo model to use. Options: veo-3.1-generate-preview (default, latest), veo-3-generate-preview, veo-2-generate-preview.',
        },
        imagePath: {
          type: 'string',
          description: 'Optional: Absolute file path to an image to use as the first frame (image-to-video generation).',
        },
        lastFramePath: {
          type: 'string',
          description:
            'Optional: Absolute file path to an image to use as the last frame (first+last frame interpolation). Requires imagePath to be set.',
        },
        aspectRatio: {
          type: 'string',
          description: 'Aspect ratio of the video. Options: "16:9" (default, landscape), "9:16" (portrait).',
        },
        resolution: {
          type: 'string',
          description: 'Video resolution. Options: "720p" (default), "1080p", "4k".',
        },
        durationSeconds: {
          type: 'number',
          description: 'Video duration in seconds. Options: 4, 6, 8 (default varies by model).',
        },
        numberOfVideos: {
          type: 'number',
          description: 'Number of video variants to generate (default: 1).',
        },
        negativePrompt: {
          type: 'string',
          description: 'Optional: Elements to avoid in the generated video.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'list_video_history',
    description: 'List recently generated videos with their prompts, models, and timestamps.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        count: {
          type: 'number',
          description: 'Number of recent videos to show (default: 10, max: 50)',
        },
      },
    },
  },
  {
    name: 'get_status',
    description: 'Check the current configuration status, active model, and last image/video information.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'list_history',
    description: 'List recently generated and edited images with their prompts and timestamps.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        count: {
          type: 'number',
          description: 'Number of recent images to show (default: 10, max: 50)',
        },
      },
    },
  },
  {
    name: 'configure_openai_api_key',
    description: 'Set or update the OpenAI API key for image generation. The key is stored locally.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        apiKey: {
          type: 'string',
          description: 'Your OpenAI API key',
        },
      },
      required: ['apiKey'],
    },
  },
  {
    name: 'generate_openai_image',
    description: 'Generate a new image from a text description using OpenAI DALL-E models.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of the image to generate',
        },
        model: {
          type: 'string',
          description: 'Model to use (e.g. dall-e-3 or dall-e-2)',
        },
        size: {
          type: 'string',
          description: 'Image size (e.g. 1024x1024)',
        }
      },
      required: ['prompt'],
    },
  },
  {
    name: 'configure_chatgpt_login',
    description:
      'Set up the free, unofficial "chatgpt-web" mode by opening a real Chrome window against chatgpt.com so you can log in by hand. The session is saved to a persistent local browser profile (no API key needed). Run this once, and again whenever the session expires.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'generate_chatgpt_image',
    description:
      'Generate an image by driving your logged-in ChatGPT web session (chatgpt.com) with a real browser — uses your ChatGPT account/subscription instead of the OpenAI API. Requires configure_chatgpt_login to have been run first. Slower than the API (drives an actual browser) and depends on ChatGPT\'s UI staying stable.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate. Phrase it as an explicit image request.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'configure_gemini_browser_login',
    description:
      'Set up a free "gemini-browser" mode by opening a real Chrome window against gemini.google.com so you can log in by hand. The session is saved to a persistent local browser profile (no API key, no cookie extraction). Run this once, and again whenever the session expires. This is separate from configure_google_login (raw cookie mode).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'generate_gemini_browser_image',
    description:
      'Generate an image by driving your logged-in Gemini web session (gemini.google.com) with a real browser instead of an API key or scraped cookies. Requires configure_gemini_browser_login to have been run first. Slower than the other Gemini modes (drives an actual browser) and depends on Gemini\'s UI staying stable.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate. Phrase it as an explicit image request.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'configure_storage',
    description: 'Set the default directory for saving generated images and videos. Paths can be absolute.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        imageDir: {
          type: 'string',
          description: 'Absolute path to the directory for saving images (e.g. ~/Desktop/Images)',
        },
        videoDir: {
          type: 'string',
          description: 'Absolute path to the directory for saving videos',
        }
      }
    }
  },
] as const;

export default TOOLS;

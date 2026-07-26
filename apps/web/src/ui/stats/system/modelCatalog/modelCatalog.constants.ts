import type { ModelCatalogModelKind, ModelCatalogImportPackageDto, ModelCatalogVendorAuthType, ProfileKind } from './deps'

export const DOC_TO_MODEL_CATALOG_ACTIVATION_PROMPT_ZH = `你是「JarvisHub 模型管理（系统级）」配置生成器。
我会提供第三方厂商接口文档（可能是 Markdown / 链接 / 请求示例 / 响应示例）。
你的任务：把文档内容转换为一段“可直接导入”的 JSON，用于 /stats -> 模型管理（系统级）-> 一键导入。

硬性要求（必须遵守）：
1) 只输出一段 JSON（不要 Markdown、不要解释、不要代码块围栏）。
2) JSON 不得包含任何密钥/凭证字段与值：apiKey/secret/token/password/authKey/Authorization/Bearer 等都不允许出现；唯一允许出现的 “key/alias” 仅限 vendor.key（厂商标识）、modelKey（模型标识）与 modelAlias（public 别名）。
3) 所有可读的中文字段请使用中文填写：vendor.name、models[].labelZh、mappings[].name（不要输出英文说明）。
4) JSON 必须符合以下导入结构（字段齐全、类型正确）：
{
  "version": "v2",
  "exportedAt": "ISO8601(可选)",
  "vendors": [
    {
      "vendor": {
        "key": "vendorKey(小写)",
        "name": "厂商显示名",
        "enabled": true,
        "baseUrlHint": "https://api.example.com(可选)",
        "authType": "bearer|x-api-key|query|none(可选)"
      },
      "models": [
        {
          "modelKey": "xxx",
          "modelAlias": "public-xxx(可选)",
          "labelZh": "中文名",
          "kind": "multimodal|image|video",
          "enabled": true
        }
      ],
      "mappings": [
        {
          "taskKind": "chat|prompt_refine|text_to_image|image_edit|image_to_prompt|text_to_video|image_to_video",
          "name": "默认映射",
          "enabled": true,
          "requestProfile": {
            "enabled": true,
            "version": "v2",
            "status_mapping": {},
            "create": { "default": {} },
            "query": { "default": {} }
          }
        }
      ]
    }
  ]
}

生成规则：
- vendor.key：选择最稳定的厂商标识（全小写、短、无空格），例如 openai/gemini/veo/apimart。
- baseUrlHint：如果文档明确了 Host/BaseUrl，则填入（仅到 host 级别即可）。
- authType：从文档判断鉴权方式：
  - bearer：Authorization: Bearer <...>
  - x-api-key：X-API-Key: <...> 或 x-api-key: <...>
  - query：?api_key=... 或 ?key=...
  - none：无需鉴权
- models：能列多少列多少；kind 按能力选择 multimodal/image/video。
- mappings：至少提供 1 个映射；优先输出 requestProfile.version = "v2"，结构尽量贴近真实厂商接口，不要拆回旧的 requestMapping/responseMapping。
  - 推荐保留 create.default / query.default 的原始 method/path/headers/query/body。
  - response_mapping、provider_meta_mapping、status_mapping 能提取就提取；不清楚就留空对象，不要猜。
  - 如果存在多条创建分支（例如有图走 image-to-video，无图走 text-to-video），请使用 create.candidates + create.default。
  - 如果接口是 multipart/form-data 且某字段期望“文件”，但你只有 URL / dataURL，可用 transform 标记（不要自造其它 transform 名）：
    {
      "requestProfile": {
        "enabled": true,
        "version": "v2",
        "create": {
          "default": {
            "method": "POST",
            "path": "/v1/xxx",
            "contentType": "multipart",
            "body": {
              "prompt": "{{request.prompt}}",
              "input_reference": { "from": "request.params.firstFrameUrl", "transform": "fetchAsFile" }
            }
          }
        },
        "query": { "default": {} }
      }
    }

如果文档缺少字段：宁可留空对象 {}，也不要猜测。
现在开始：根据我接下来粘贴的“接口文档内容”，输出最终可导入 JSON。`

export const KIND_OPTIONS: Array<{ value: ModelCatalogModelKind; label: string }> = [
  { value: 'multimodal', label: '多模态' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
]

export const TASK_KIND_OPTIONS: Array<{ value: ProfileKind; label: string }> = [
  { value: 'chat', label: 'chat（文本）' },
  { value: 'prompt_refine', label: 'prompt_refine（指令优化）' },
  { value: 'text_to_image', label: 'text_to_image（图片）' },
  { value: 'image_edit', label: 'image_edit（图像编辑）' },
  { value: 'image_to_prompt', label: 'image_to_prompt（图像理解）' },
  { value: 'text_to_video', label: 'text_to_video（视频）' },
  { value: 'image_to_video', label: 'image_to_video（图像转视频）' },
]

export const AUTH_TYPE_OPTIONS: Array<{ value: ModelCatalogVendorAuthType; label: string }> = [
  { value: 'bearer', label: 'bearer（Authorization: Bearer <key>）' },
  { value: 'x-api-key', label: 'x-api-key（X-API-Key）' },
  { value: 'query', label: 'query（?api_key=...）' },
  { value: 'none', label: 'none（无需鉴权）' },
]

export const PAGE_SIZE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '10', label: '10 / 页' },
  { value: '20', label: '20 / 页' },
  { value: '50', label: '50 / 页' },
]

export const IMPORT_TEMPLATE: ModelCatalogImportPackageDto = {
  version: 'v2',
  vendors: [
    {
      vendor: {
        key: 'apimart',
        name: 'APIMart',
        enabled: true,
        baseUrlHint: 'https://api.apimart.ai',
        authType: 'bearer',
      },
      models: [
        {
          modelKey: 'gpt-image-2',
          modelAlias: 'gpt-image-2',
          labelZh: 'GPT Image 2',
          kind: 'image',
          enabled: true,
          meta: {
            useCases: ['文本生图', '参考图改图', '画布图片节点'],
            imageOptions: {
              defaultAspectRatio: '1:1',
              defaultImageSize: '2k',
              aspectRatioOptions: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21'],
              imageSizeOptions: [{ value: '1k', label: '1K' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }],
              resolutionOptions: ['1k', '2k', '4k'],
              supportsReferenceImages: true,
              supportsTextToImage: true,
              supportsImageToImage: true,
            },
          },
        },
        {
          modelKey: 'doubao-seedance-2.0',
          modelAlias: 'seedance2',
          labelZh: 'Seedance 2.0',
          kind: 'video',
          enabled: true,
          meta: {
            useCases: ['图生视频', '有声视频', '画布视频节点'],
            videoOptions: {
              defaultDurationSeconds: 5,
              defaultSize: '16:9',
              defaultResolution: '720p',
              durationOptions: Array.from({ length: 12 }, (_item, index) => {
                const value = index + 4
                return { value, label: `${value}s` }
              }),
              sizeOptions: [
                { value: '16:9', label: '16:9 横屏', orientation: 'landscape', aspectRatio: '16:9' },
                { value: '9:16', label: '9:16 竖屏', orientation: 'portrait', aspectRatio: '9:16' },
                { value: '1:1', label: '1:1 方形', orientation: 'landscape', aspectRatio: '1:1' },
                { value: '4:3', label: '4:3 传统', orientation: 'landscape', aspectRatio: '4:3' },
                { value: '3:4', label: '3:4 竖向传统', orientation: 'portrait', aspectRatio: '3:4' },
                { value: '21:9', label: '21:9 超宽屏', orientation: 'landscape', aspectRatio: '21:9' },
                { value: 'adaptive', label: '自适应', orientation: 'landscape', aspectRatio: '16:9' },
              ],
              resolutionOptions: [{ value: '720p', label: '720p 高清' }],
              orientationOptions: [
                { value: 'landscape', label: '横屏', size: '16:9', aspectRatio: '16:9' },
                { value: 'portrait', label: '竖屏', size: '9:16', aspectRatio: '9:16' },
              ],
              controls: [
                { key: 'duration', binding: 'durationSeconds', label: '时长' },
                { key: 'size', binding: 'size', label: '画幅' },
                { key: 'resolution', binding: 'resolution', label: '分辨率' },
                { key: 'generate_audio', binding: 'generateAudio', label: '声音' },
              ],
            },
          },
        },
      ],
      mappings: [],
    },
  ],
}

export function buildRequestProfileV2Template(taskKind: ProfileKind): Record<string, unknown> {
  const defaultBodyByTaskKind: Record<ProfileKind, Record<string, unknown>> = {
    chat: {
      model: '{{model.model_key}}',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '{{request.prompt}}',
            },
          ],
        },
      ],
      max_tokens: '{{request.params.max_tokens}}',
    },
    prompt_refine: {
      model: '{{model.model_key}}',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '{{request.prompt}}',
            },
          ],
        },
      ],
      max_tokens: '{{request.params.max_tokens}}',
    },
    text_to_image: {
      model: '{{model.model_key}}',
      prompt: '{{request.prompt}}',
      size: '{{request.params.size}}',
      n: '{{request.params.n}}',
    },
    image_edit: {
      model: '{{model.model_key}}',
      prompt: '{{request.prompt}}',
      image_url: '{{request.params.image_url}}',
      mask_url: '{{request.params.mask_url}}',
    },
    image_to_prompt: {
      model: '{{model.model_key}}',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '{{request.prompt}}',
            },
            {
              type: 'image_url',
              image_url: {
                url: '{{request.params.image_url}}',
              },
            },
          ],
        },
      ],
      max_tokens: '{{request.params.max_tokens}}',
    },
    text_to_video: {
      model: '{{model.model_key}}',
      prompt: '{{request.prompt}}',
      duration: '{{request.params.duration}}',
      size: '{{request.params.size}}',
    },
    image_to_video: {
      model: '{{model.model_key}}',
      prompt: '{{request.prompt}}',
      image_url: '{{request.params.image_url}}',
      duration: '{{request.params.duration}}',
      size: '{{request.params.size}}',
    },
  }

  return {
    enabled: true,
    version: 'v2',
    status_mapping: {
      failed: ['error', 'failed', 'timeout', 'expired'],
      succeeded: ['succeeded', 'success', 'completed', 'stop', 'length'],
    },
    create: {
      default: {
        name: 'create',
        method: 'POST',
        path: '/v1/tasks',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer {{account.account_key}}',
        },
        query: {},
        body: defaultBodyByTaskKind[taskKind],
        response_mapping: {
          task_id: ['id', 'task_id', 'data.id', 'data.task_id'],
          status: ['status', 'data.status', 'choices.0.finish_reason'],
          assets: ['data.output_url', 'data.url', 'choices.0.message.content'],
        },
        provider_meta_mapping: {
          query_id: ['id', 'task_id', 'data.id', 'data.task_id'],
        },
      },
    },
    query: {
      default: {
        name: 'query',
        method: 'GET',
        path: '/v1/tasks/{{providerMeta.query_id}}',
        headers: {
          Authorization: 'Bearer {{account.account_key}}',
        },
        query: {},
        body: null,
        response_mapping: {
          task_id: ['id', 'task_id', 'data.id', 'data.task_id'],
          status: ['status', 'data.status', 'choices.0.finish_reason'],
          assets: ['data.output_url', 'data.url', 'choices.0.message.content'],
        },
      },
    },
  }
}

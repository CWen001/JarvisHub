export type ImageViewEditMode = 'inPlace' | 'newNode'

export type ImageViewEditModeInput = {
  /** Current node kind. Only imageEdit can be overwritten in-place safely
   *  (image kind is the original source — never mutate it). */
  kind: string | null | undefined
  /** User toggle preference; null = use default. */
  preference: ImageViewEditMode | null
}

// Why this exists: handleApplyImageViewEdit used to unconditionally addNode.
// We add a user-facing toggle. Default is 'newNode' for image kind (preserve
// originals); default is 'inPlace' for imageEdit kind (avoid chain proliferation).
// Mirrors handlePoseSaved's shouldOverwriteInPlace logic at TaskNode.tsx:2863.
export function decideImageViewEditMode(input: ImageViewEditModeInput): ImageViewEditMode {
  if (input.preference === 'inPlace' || input.preference === 'newNode') {
    return input.preference
  }
  return input.kind === 'imageEdit' ? 'inPlace' : 'newNode'
}

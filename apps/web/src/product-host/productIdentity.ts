export type ProductBrand = Readonly<{
  name: string
  mark: string
  accentColor: string
}>

export const sharedProductBrand = Object.freeze({
  name: 'Design Studio',
  mark: 'D',
  accentColor: '#29463f',
}) satisfies ProductBrand

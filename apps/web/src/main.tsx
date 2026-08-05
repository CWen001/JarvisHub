import React from 'react'
import App from './App'
import { bootstrapJarvisApp } from './bootstrap'
import { installedVerticalSkills } from './product-host/installedVerticalSkills'
import { sharedProductBrand } from './product-host/productIdentity'
import { installVerticalProductHost } from './product-host/productHost'

async function startInstalledProduct(): Promise<void> {
  await installVerticalProductHost(installedVerticalSkills)
  bootstrapJarvisApp(<App productBrand={sharedProductBrand} />)
}

void startInstalledProduct().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Vertical Product Host installation failed'
  bootstrapJarvisApp(
    <main className="product-installation-error" role="alert">
      <h1>Product extension unavailable</h1>
      <p>{message}</p>
    </main>,
  )
})

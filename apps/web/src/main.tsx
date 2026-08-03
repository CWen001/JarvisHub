import React from 'react'
import App from './App'
import { bootstrapJarvisApp } from './bootstrap'
import { installedVerticalExtension } from './product-host/installedExtension'
import { installVerticalProductHost } from './product-host/productHost'

async function startInstalledProduct(): Promise<void> {
  await installVerticalProductHost(installedVerticalExtension)
  bootstrapJarvisApp(<App extension={installedVerticalExtension} />)
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

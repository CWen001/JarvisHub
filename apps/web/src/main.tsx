import React from 'react'
import App from './App'
import { bootstrapJarvisApp } from './bootstrap'
import { installedVerticalExtension } from './product-host/installedExtension'

bootstrapJarvisApp(<App extension={installedVerticalExtension} />)

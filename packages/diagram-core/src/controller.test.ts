import { createDiagramController } from './controller'
import { defineControllerConformance } from './testing'

defineControllerConformance('the built-in controller', () => createDiagramController())

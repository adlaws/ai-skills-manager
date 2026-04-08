/**
 * Shared context passed to all command registration modules.
 * Provides access to services, providers, and helper functions.
 */

import * as vscode from 'vscode';
import { ResourceItem, InstalledResource } from '../types';
import { ResourceClient } from '../github/resourceClient';
import {
    MarketplaceTreeDataProvider,
    ResourceTreeItem,
} from '../views/marketplaceProvider';
import {
    InstalledTreeDataProvider,
    InstalledResourceTreeItem,
} from '../views/installedProvider';
import {
    LocalTreeDataProvider,
    LocalResourceTreeItem,
} from '../views/localProvider';
import { InstallationService } from '../services/installationService';
import { PathService } from '../services/pathService';
import { ScaffoldingService } from '../services/scaffoldingService';
import { PackService } from '../services/packService';
import { ValidationService } from '../services/validationService';
import { ConfigService } from '../services/configService';
import { UsageDetectionService } from '../services/usageDetectionService';
import { ContributionService } from '../services/contributionService';

export interface CommandContext {
    extensionContext: vscode.ExtensionContext;
    client: ResourceClient;
    installationService: InstallationService;
    pathService: PathService;
    scaffoldingService: ScaffoldingService;
    packService: PackService;
    validationService: ValidationService;
    configService: ConfigService;
    usageDetectionService: UsageDetectionService;
    contributionService: ContributionService;
    marketplaceProvider: MarketplaceTreeDataProvider;
    installedProvider: InstalledTreeDataProvider;
    localProvider: LocalTreeDataProvider;

    // Helper functions
    resolveMarketplaceItems: (
        clicked: ResourceTreeItem | ResourceItem,
        selected?: readonly (ResourceTreeItem | ResourceItem)[],
    ) => ResourceItem[];
    resolveInstalledItems: (
        clicked: InstalledResourceTreeItem | InstalledResource,
        selected?: readonly (InstalledResourceTreeItem | InstalledResource)[],
    ) => InstalledResource[];
    resolveLocalItems: (
        clicked: LocalResourceTreeItem | ResourceItem,
        selected?: readonly (LocalResourceTreeItem | ResourceItem)[],
    ) => ResourceItem[];
    syncInstalledStatus: () => Promise<void>;
    checkForUpdates: () => Promise<void>;
    checkForModifications: () => Promise<void>;
    buildResourceItemFromInstalled: (
        resource: InstalledResource,
    ) => Promise<ResourceItem | undefined>;
}

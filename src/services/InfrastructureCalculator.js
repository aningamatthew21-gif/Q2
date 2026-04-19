/**
 * Infrastructure Calculator Service
 * Computes infrastructure requirements based on building specifications
 */

import { ENHANCED_BOM_SCHEMA } from './EnhancedDataSchemas.js';

export class InfrastructureCalculator {
  constructor() {
    // Industry standard calculation formulas
    this.calculationRules = {
      access_control: {
        readers: {
          base: 2, // Minimum readers per floor
          perFloor: 1.5, // Additional readers per floor
          perEntrance: 2, // Readers per entrance
          perUser: 0.02 // Additional readers per user
        },
        controllers: {
          base: 1, // Minimum controllers
          perFloor: 1, // Controller per floor
          perReader: 0.25 // Controllers per reader
        },
        locks: {
          perReader: 1, // Lock per reader
          perExit: 1, // Emergency exit locks
          perFloor: 2 // Additional locks per floor
        },
        power: {
          reader: 12, // Watts per reader
          controller: 24, // Watts per controller
          lock: 8 // Watts per lock
        }
      },
      cctv: {
        cameras: {
          perFloor: 4, // Cameras per floor
          perEntrance: 2, // Cameras per entrance
          perUser: 0.1 // Additional cameras per user
        },
        nvr: {
          base: 1, // Minimum NVRs
          perCamera: 0.1 // NVRs per camera
        },
        power: {
          camera: 15, // Watts per camera
          nvr: 50 // Watts per NVR
        }
      },
      network: {
        switches: {
          base: 1, // Minimum switches
          perFloor: 1, // Switch per floor
          perUser: 0.05 // Additional switches per user
        },
        cabling: {
          perUser: 20, // Meters of CAT6 per user
          perFloor: 100, // Base cabling per floor
          perCamera: 15, // Cabling per camera
          perReader: 10 // Cabling per reader
        },
        power: {
          switch: 30, // Watts per switch
          perPort: 15.4 // PoE power per port
        }
      }
    };

    // Product specifications database
    this.productSpecs = {
      readers: [
        { sku: 'READER-001', type: 'card', power: 12, features: ['wiegand', 'mifare'] },
        { sku: 'READER-002', type: 'biometric', power: 15, features: ['fingerprint', 'wiegand'] },
        { sku: 'READER-003', type: 'dual', power: 18, features: ['card', 'biometric', 'wiegand'] }
      ],
      controllers: [
        { sku: 'CTRL-001', type: '4-door', power: 24, capacity: 4, features: ['wiegand', 'rs485'] },
        { sku: 'CTRL-002', type: '8-door', power: 48, capacity: 8, features: ['wiegand', 'tcp/ip'] },
        { sku: 'CTRL-003', type: '16-door', power: 72, capacity: 16, features: ['wiegand', 'tcp/ip', 'poe'] }
      ],
      locks: [
        { sku: 'LOCK-001', type: 'maglock', power: 8, features: ['fail-safe'] },
        { sku: 'LOCK-002', type: 'strike', power: 6, features: ['fail-secure'] },
        { sku: 'LOCK-003', type: 'electric', power: 10, features: ['fail-safe', 'monitored'] }
      ],
      cameras: [
        { sku: 'CAM-001', type: 'dome', power: 15, features: ['1080p', 'poe', 'night-vision'] },
        { sku: 'CAM-002', type: 'bullet', power: 18, features: ['4k', 'poe', 'weatherproof'] },
        { sku: 'CAM-003', type: 'ptz', power: 25, features: ['4k', 'poe', 'zoom', 'pan-tilt'] }
      ],
      switches: [
        { sku: 'SW-001', type: '24-port', power: 30, ports: 24, poe: 16, features: ['managed', 'poe+'] },
        { sku: 'SW-002', type: '48-port', power: 60, ports: 48, poe: 32, features: ['managed', 'poe+'] },
        { sku: 'SW-003', type: '8-port', power: 15, ports: 8, poe: 8, features: ['unmanaged', 'poe'] }
      ]
    };
  }

  /**
   * Calculate complete infrastructure requirements
   * @param {Object} buildingSpec - Building specification
   * @returns {Object} Infrastructure calculation result
   */
  calculateInfrastructure(buildingSpec) {
    try {
      const result = {
        access_control: this.calculateAccessControl(buildingSpec),
        cctv: this.calculateCCTV(buildingSpec),
        network: this.calculateNetwork(buildingSpec),
        power: this.calculatePower(buildingSpec),
        cabling: this.calculateCabling(buildingSpec),
        labor: this.calculateLabor(buildingSpec)
      };

      return this.validateAndOptimize(result, buildingSpec);
    } catch (error) {
      console.error('Error calculating infrastructure:', error);
      return this.getDefaultInfrastructure();
    }
  }

  /**
   * Calculate access control requirements
   */
  calculateAccessControl(buildingSpec) {
    const { floors, users, entrances, requirements } = buildingSpec;
    
    if (!requirements.includes('access_control')) {
      return { readers: 0, controllers: 0, locks: 0 };
    }

    const rules = this.calculationRules.access_control;
    
    // Calculate readers
    const readers = Math.ceil(
      rules.readers.base +
      rules.readers.perFloor * floors +
      rules.readers.perEntrance * entrances +
      rules.readers.perUser * users
    );

    // Calculate controllers
    const controllers = Math.ceil(
      rules.controllers.base +
      rules.controllers.perFloor * floors +
      rules.controllers.perReader * readers
    );

    // Calculate locks
    const locks = Math.ceil(
      rules.locks.perReader * readers +
      rules.locks.perExit * buildingSpec.exits +
      rules.locks.perFloor * floors
    );

    return {
      readers,
      controllers,
      locks,
      reasoning: `Calculated based on ${floors} floors, ${users} users, ${entrances} entrances`
    };
  }

  /**
   * Calculate CCTV requirements
   */
  calculateCCTV(buildingSpec) {
    const { floors, users, entrances, requirements } = buildingSpec;
    
    if (!requirements.includes('cctv')) {
      return { cameras: 0, nvr: 0 };
    }

    const rules = this.calculationRules.cctv;
    
    // Calculate cameras
    const cameras = Math.ceil(
      rules.cameras.perFloor * floors +
      rules.cameras.perEntrance * entrances +
      rules.cameras.perUser * users
    );

    // Calculate NVRs
    const nvr = Math.ceil(
      rules.nvr.base +
      rules.nvr.perCamera * cameras
    );

    return {
      cameras,
      nvr,
      reasoning: `Calculated based on ${floors} floors, ${users} users, ${entrances} entrances`
    };
  }

  /**
   * Calculate network requirements
   */
  calculateNetwork(buildingSpec) {
    const { floors, users, requirements } = buildingSpec;
    
    if (!requirements.includes('network')) {
      return { switches: 0, cabling: 0 };
    }

    const rules = this.calculationRules.network;
    
    // Calculate switches
    const switches = Math.ceil(
      rules.switches.base +
      rules.switches.perFloor * floors +
      rules.switches.perUser * users
    );

    // Calculate cabling (meters)
    const cabling = Math.ceil(
      rules.cabling.perUser * users +
      rules.cabling.perFloor * floors
    );

    return {
      switches,
      cabling,
      reasoning: `Calculated based on ${floors} floors, ${users} users`
    };
  }

  /**
   * Calculate power requirements
   */
  calculatePower(buildingSpec) {
    const accessControl = this.calculateAccessControl(buildingSpec);
    const cctv = this.calculateCCTV(buildingSpec);
    const network = this.calculateNetwork(buildingSpec);

    const rules = this.calculationRules;
    
    // Calculate power consumption
    const readerPower = accessControl.readers * rules.access_control.power.reader;
    const controllerPower = accessControl.controllers * rules.access_control.power.controller;
    const lockPower = accessControl.locks * rules.access_control.power.lock;
    const cameraPower = cctv.cameras * rules.cctv.power.camera;
    const nvrPower = cctv.nvr * rules.cctv.power.nvr;
    const switchPower = network.switches * rules.network.power.switch;

    const totalPower = readerPower + controllerPower + lockPower + cameraPower + nvrPower + switchPower;

    // Calculate UPS requirements
    const upsCapacity = Math.ceil(totalPower / 1000 * 1.5); // 1.5x capacity for safety
    const upsCount = Math.ceil(upsCapacity / 3); // 3kVA units

    return {
      total: totalPower,
      breakdown: {
        readers: readerPower,
        controllers: controllerPower,
        locks: lockPower,
        cameras: cameraPower,
        nvr: nvrPower,
        switches: switchPower
      },
      ups: {
        capacity: upsCapacity,
        count: upsCount,
        runtime: 2 // hours
      },
      reasoning: `Total power: ${totalPower}W, UPS: ${upsCount}x3kVA for 2h runtime`
    };
  }

  /**
   * Calculate cabling requirements
   */
  calculateCabling(buildingSpec) {
    const accessControl = this.calculateAccessControl(buildingSpec);
    const cctv = this.calculateCCTV(buildingSpec);
    const network = this.calculateNetwork(buildingSpec);

    const rules = this.calculationRules;
    
    // Calculate total cabling
    const cat6Cabling = network.cabling + 
                       (accessControl.readers * rules.network.cabling.perReader) +
                       (cctv.cameras * rules.network.cabling.perCamera);

    // Calculate conduit requirements
    const conduit20mm = Math.ceil(cat6Cabling / 100); // 100m per conduit
    const conduit25mm = Math.ceil(cat6Cabling / 150); // 150m per conduit

    return {
      total: cat6Cabling,
      breakdown: {
        cat6: cat6Cabling,
        power: Math.ceil(cat6Cabling * 0.3), // 30% power cabling
        fiber: Math.ceil(cat6Cabling * 0.1) // 10% fiber for backbone
      },
      conduit: {
        total: conduit25mm,
        sizes: {
          '20mm': conduit20mm,
          '25mm': conduit25mm,
          '32mm': Math.ceil(conduit25mm * 0.2) // 20% larger conduit
        }
      },
      reasoning: `${cat6Cabling}m total cabling, ${conduit25mm}x25mm conduit`
    };
  }

  /**
   * Calculate labor requirements
   */
  calculateLabor(buildingSpec) {
    const accessControl = this.calculateAccessControl(buildingSpec);
    const cctv = this.calculateCCTV(buildingSpec);
    const network = this.calculateNetwork(buildingSpec);

    // Estimate labor hours based on complexity
    const installationHours = Math.ceil(
      (accessControl.readers * 2) + // 2 hours per reader
      (accessControl.controllers * 4) + // 4 hours per controller
      (cctv.cameras * 1.5) + // 1.5 hours per camera
      (network.switches * 2) + // 2 hours per switch
      (network.cabling / 100) // 1 hour per 100m cabling
    );

    const configurationHours = Math.ceil(installationHours * 0.3); // 30% of installation
    const testingHours = Math.ceil(installationHours * 0.2); // 20% of installation
    const trainingHours = Math.ceil(buildingSpec.users * 0.5); // 0.5 hours per user

    const totalHours = installationHours + configurationHours + testingHours + trainingHours;

    return {
      hours: totalHours,
      skillLevel: this.determineSkillLevel(buildingSpec),
      breakdown: {
        installation: installationHours,
        configuration: configurationHours,
        testing: testingHours,
        training: trainingHours
      },
      reasoning: `${totalHours} hours total: ${installationHours}h install, ${configurationHours}h config, ${testingHours}h test, ${trainingHours}h training`
    };
  }

  /**
   * Determine required skill level
   */
  determineSkillLevel(buildingSpec) {
    const { requirements, constraints } = buildingSpec;
    
    if (requirements.includes('cctv') && requirements.includes('network')) {
      return 'advanced';
    } else if (requirements.length > 2) {
      return 'intermediate';
    } else {
      return 'basic';
    }
  }

  /**
   * Validate and optimize infrastructure calculation
   */
  validateAndOptimize(result, buildingSpec) {
    // Apply optimization rules
    if (result.access_control.controllers > 0) {
      // Ensure we have enough controllers for readers
      const minControllers = Math.ceil(result.access_control.readers / 4);
      if (result.access_control.controllers < minControllers) {
        result.access_control.controllers = minControllers;
      }
    }

    // Apply safety margins
    result.power.total = Math.ceil(result.power.total * 1.2); // 20% safety margin
    result.cabling.total = Math.ceil(result.cabling.total * 1.1); // 10% waste factor

    return result;
  }

  /**
   * Get default infrastructure for fallback
   */
  getDefaultInfrastructure() {
    return {
      access_control: { readers: 2, controllers: 1, locks: 2 },
      cctv: { cameras: 4, nvr: 1 },
      network: { switches: 1, cabling: 200 },
      power: { total: 500, ups: { capacity: 1, count: 1, runtime: 2 } },
      cabling: { total: 200, conduit: { total: 2 } },
      labor: { hours: 40, skillLevel: 'basic' }
    };
  }

  /**
   * Generate BOM from infrastructure calculation
   * @param {Object} infrastructure - Infrastructure calculation result
   * @param {Object} buildingSpec - Building specification
   * @returns {Object} Complete BOM
   */
  generateBOM(infrastructure, buildingSpec) {
    const lineItems = [];

    // Add access control items
    if (infrastructure.access_control.readers > 0) {
      lineItems.push({
        sku: 'READER-001',
        description: 'Card Reader - Standard',
        quantity: infrastructure.access_control.readers,
        reasoning: `Access control readers for ${buildingSpec.floors} floors, ${buildingSpec.users} users`,
        confidence: 0.9
      });
    }

    if (infrastructure.access_control.controllers > 0) {
      lineItems.push({
        sku: 'CTRL-001',
        description: 'Access Controller - 4 Door',
        quantity: infrastructure.access_control.controllers,
        reasoning: `Controllers to manage ${infrastructure.access_control.readers} readers`,
        confidence: 0.9
      });
    }

    if (infrastructure.access_control.locks > 0) {
      lineItems.push({
        sku: 'LOCK-001',
        description: 'Magnetic Lock - Fail Safe',
        quantity: infrastructure.access_control.locks,
        reasoning: `Locks for ${infrastructure.access_control.readers} readers and exits`,
        confidence: 0.9
      });
    }

    // Add CCTV items
    if (infrastructure.cctv.cameras > 0) {
      lineItems.push({
        sku: 'CAM-001',
        description: 'IP Camera - Dome 1080p',
        quantity: infrastructure.cctv.cameras,
        reasoning: `Surveillance cameras for ${buildingSpec.floors} floors`,
        confidence: 0.8
      });
    }

    if (infrastructure.cctv.nvr > 0) {
      lineItems.push({
        sku: 'NVR-001',
        description: 'Network Video Recorder',
        quantity: infrastructure.cctv.nvr,
        reasoning: `NVR for ${infrastructure.cctv.cameras} cameras`,
        confidence: 0.8
      });
    }

    // Add network items
    if (infrastructure.network.switches > 0) {
      lineItems.push({
        sku: 'SW-001',
        description: 'Network Switch - 24 Port PoE',
        quantity: infrastructure.network.switches,
        reasoning: `Network switches for ${buildingSpec.users} users`,
        confidence: 0.8
      });
    }

    // Add cabling items
    if (infrastructure.cabling.total > 0) {
      const cableBoxes = Math.ceil(infrastructure.cabling.total / 305); // 305m per box
      lineItems.push({
        sku: 'CABLE-001',
        description: 'CAT6 Cable - 305m Box',
        quantity: cableBoxes,
        reasoning: `${infrastructure.cabling.total}m total cabling required`,
        confidence: 0.9
      });
    }

    // Add UPS items
    if (infrastructure.power.ups.count > 0) {
      lineItems.push({
        sku: 'UPS-001',
        description: 'UPS - 3kVA',
        quantity: infrastructure.power.ups.count,
        reasoning: `Backup power for ${infrastructure.power.total}W total load`,
        confidence: 0.9
      });
    }

    return {
      lineItems,
      infrastructure,
      costs: this.calculateCosts(lineItems),
      compliance: this.checkCompliance(lineItems, buildingSpec)
    };
  }

  /**
   * Calculate costs for BOM items
   */
  calculateCosts(lineItems) {
    // This would typically fetch from your inventory/pricing system
    const basePrices = {
      'READER-001': 150,
      'CTRL-001': 300,
      'LOCK-001': 80,
      'CAM-001': 200,
      'NVR-001': 500,
      'SW-001': 400,
      'CABLE-001': 250,
      'UPS-001': 800
    };

    let subtotal = 0;
    lineItems.forEach(item => {
      const price = basePrices[item.sku] || 100;
      item.unitPrice = price;
      item.lineTotal = price * item.quantity;
      subtotal += item.lineTotal;
    });

    return {
      subtotal,
      duties: subtotal * 0.20, // 20% duty
      taxes: {
        vat: subtotal * 0.15,
        nhil: subtotal * 0.025,
        getfund: subtotal * 0.025,
        covid: subtotal * 0.01
      },
      total: subtotal * 1.41 // Including duties and taxes
    };
  }

  /**
   * Check compliance requirements
   */
  checkCompliance(lineItems, buildingSpec) {
    const issues = [];
    const autoAdded = [];

    // Check for backup power requirement
    if (buildingSpec.totalArea > 500 && !lineItems.find(item => item.sku.startsWith('UPS'))) {
      issues.push({
        rule: 'Backup Power Requirement',
        severity: 'high',
        description: 'Buildings over 500sqm require backup power',
        resolution: 'Add UPS system'
      });
      
      autoAdded.push({
        sku: 'UPS-001',
        reason: 'Regulatory requirement for buildings >500sqm',
        rule: 'Building Code'
      });
    }

    // Check for emergency exit locks
    if (buildingSpec.exits > 0 && !lineItems.find(item => item.sku.startsWith('LOCK'))) {
      issues.push({
        rule: 'Emergency Exit Security',
        severity: 'medium',
        description: 'Emergency exits require secure locks',
        resolution: 'Add emergency exit locks'
      });
    }

    return {
      status: issues.length === 0 ? 'compliant' : 'partial',
      issues,
      autoAdded
    };
  }
}

export default InfrastructureCalculator;

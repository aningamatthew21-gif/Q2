/**
 * Data Migration Script for Enhanced Quote System
 * Migrates existing inventory items to include cost components
 */

// This script should be run in the browser console or as a Node.js script
// Make sure you're authenticated and have access to your Firebase project

const migrationScript = {
  // Configuration
  config: {
    appId: 'default-app-id', // Replace with your actual app ID
    firebaseConfig: {
      apiKey: "AIzaSyCiRyWj3d9V0V_KwiNG7MxChUvKiqi6tDE",
      authDomain: "quote-system-a7e73.firebaseapp.com",
      projectId: "quote-system-a7e73",
      storageBucket: "quote-system-a7e73.appspot.com",
      messagingSenderId: "165157467841",
      appId: "1:165157467841:web:e5d8e305ed8d361b134640",
      measurementId: "G-4XD5MCBTWY"
    }
  },

  /**
   * Migrate inventory items to include cost components
   */
  async migrateInventoryItems() {
    console.log('🔄 Starting inventory migration...');
    
    try {
      // Get all inventory items
      const inventoryRef = collection(db, `artifacts/${this.config.appId}/public/data/inventory`);
      const snapshot = await getDocs(inventoryRef);
      
      const batch = writeBatch(db);
      let count = 0;
      
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        
        // Only migrate if cost components don't exist
        if (!data.costComponents) {
          const updateData = {
            unitCost: data.price || 0, // Use existing price as base cost
            costComponents: {
              inboundFreightPerUnit: 0,
              dutyPerUnit: 0,
              insurancePerUnit: 0,
              packagingPerUnit: 0,
              otherPerUnit: 0
            },
            weightKg: 0,
            markupOverridePercent: null,
            pricingTier: 'standard',
            updatedAt: new Date().toISOString(),
            migrated: true
          };
          
          batch.update(doc.ref, updateData);
          count++;
        }
      });
      
      if (count > 0) {
        await batch.commit();
        console.log(`✅ Migrated ${count} inventory items`);
      } else {
        console.log('ℹ️ No items needed migration');
      }
      
      return count;
    } catch (error) {
      console.error('❌ Migration error:', error);
      throw error;
    }
  },

  /**
   * Create default pricing settings
   */
  async createDefaultPricingSettings() {
    console.log('🔄 Creating default pricing settings...');
    
    try {
      const settingsRef = doc(db, `artifacts/${this.config.appId}/public/data/settings`, 'pricing');
      const settingsSnap = await getDoc(settingsRef);
      
      if (!settingsSnap.exists()) {
        const defaultSettings = {
          defaultMarkupPercent: 32,
          pricingMode: 'markup',
          allocationMethod: 'weight',
          roundingDecimals: 2,
          defaultIncoterm: 'FOB',
          defaultCurrency: 'GHS',
          defaultQuoteExpiryDays: 30,
          approvalThresholds: {
            minMarginPercent: 15,
            maxDiscountPercent: 20,
            requireApprovalAbove: 10000
          },
          taxRules: {
            defaultRate: 0.12
          },
          createdAt: new Date().toISOString()
        };
        
        await setDoc(settingsRef, defaultSettings);
        console.log('✅ Created default pricing settings');
      } else {
        console.log('ℹ️ Pricing settings already exist');
      }
    } catch (error) {
      console.error('❌ Settings creation error:', error);
      throw error;
    }
  },

  /**
   * Validate migration results
   */
  async validateMigration() {
    console.log('🔄 Validating migration...');
    
    try {
      // Check inventory items
      const inventoryRef = collection(db, `artifacts/${this.config.appId}/public/data/inventory`);
      const inventorySnapshot = await getDocs(inventoryRef);
      
      let migratedCount = 0;
      let totalCount = 0;
      
      inventorySnapshot.docs.forEach(doc => {
        const data = doc.data();
        totalCount++;
        if (data.costComponents) {
          migratedCount++;
        }
      });
      
      // Check pricing settings
      const settingsRef = doc(db, `artifacts/${this.config.appId}/public/data/settings`, 'pricing');
      const settingsSnap = await getDoc(settingsRef);
      
      console.log('📊 Migration Results:');
      console.log(`   Inventory items: ${migratedCount}/${totalCount} migrated`);
      console.log(`   Pricing settings: ${settingsSnap.exists() ? 'Created' : 'Missing'}`);
      
      if (migratedCount === totalCount && settingsSnap.exists()) {
        console.log('✅ Migration completed successfully!');
        return true;
      } else {
        console.log('⚠️ Migration incomplete');
        return false;
      }
    } catch (error) {
      console.error('❌ Validation error:', error);
      throw error;
    }
  },

  /**
   * Run complete migration
   */
  async runMigration() {
    console.log('🚀 Starting Enhanced Quote System Migration...');
    console.log('=====================================');
    
    try {
      // Step 1: Migrate inventory items
      await this.migrateInventoryItems();
      
      // Step 2: Create pricing settings
      await this.createDefaultPricingSettings();
      
      // Step 3: Validate results
      const success = await this.validateMigration();
      
      if (success) {
        console.log('=====================================');
        console.log('🎉 Migration completed successfully!');
        console.log('Your system is now ready for enhanced quotes.');
        console.log('');
        console.log('Next steps:');
        console.log('1. Deploy Cloud Functions (if not already done)');
        console.log('2. Test the new Pricing Management UI');
        console.log('3. Test the Enhanced Quote Editor');
        console.log('4. Train users on new features');
      }
      
      return success;
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }
};

// Browser console usage:
// 1. Open your app in the browser
// 2. Open Developer Tools (F12)
// 3. Go to Console tab
// 4. Copy and paste this entire script
// 5. Run: migrationScript.runMigration()

// Node.js usage:
// 1. Install Firebase SDK: npm install firebase
// 2. Create a separate file with this script
// 3. Import Firebase and run the migration

console.log('📋 Data Migration Script Loaded');
console.log('To run migration, call: migrationScript.runMigration()');

// Export for Node.js usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = migrationScript;
}

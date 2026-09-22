'use strict';

const Homey = require('homey');
const { HomeyAPI } = require('homey-api');

module.exports = class MoodStateApp extends Homey.App {

  async onInit() {
    const api = await HomeyAPI.createAppAPI({
      homey: this.homey,
    });

    const cardMoodIsActive = this.homey.flow.getConditionCard('mood-is-active');

    cardMoodIsActive.registerArgumentAutocompleteListener('mood', async (query, args) => {
      const moods = await api.moods.getMoods();
      const zones = await api.zones.getZones();
      return Object.values(moods)
        .filter((mood) => mood.name.toLowerCase().includes(query.toLowerCase()))
        .map((mood) => {
          return {
            name: mood.name,
            description: zones[mood.zone]?.name,
            id: mood.id,
          };
        });
    });

    cardMoodIsActive.registerRunListener(async (args) => {
      const mood = await api.moods.getMood({ id: args.mood.id });
      if (!mood?.devices) {
        return false;
      }
      const deviceEntries = Object.entries(mood.devices);
      const devicesById = {};
      await Promise.all(
        deviceEntries.map(async ([deviceId]) => {
          devicesById[deviceId] = await api.devices.getDevice({ id: deviceId });
        }),
      );
      for (const [deviceId, moodData] of deviceEntries) {
        const device = devicesById[deviceId];
        // Device not found
        if (!device) return false;
        // Device is offline
        if (!device.available) return false;

        // If onoff capability is set to false in the mood, only compare the onoff capability and ignore the rest
        if (Object.prototype.hasOwnProperty.call(moodData.state, 'onoff')) {
          const moodOnoff = moodData.state.onoff;
          const deviceOnoffCap = device.capabilitiesObj?.['onoff'];
          if (deviceOnoffCap) {
            const deviceOnoffValue = deviceOnoffCap.value;
            if (moodOnoff === false && deviceOnoffValue === false) {
              // Device is off and mood expects it off — other capabilities don't matter for this device
              continue;
            }
          }
        }

        for (const [capabilityId, moodValue] of Object.entries(moodData.state)) {
          const cap = device.capabilitiesObj?.[capabilityId];
          if (!cap) {
            // Capability not found on device
            continue;
          }
          const deviceValue = cap.value;
          if (typeof moodValue === 'number') {
            // Slight relaxation for float comparisons
            if (Math.abs(deviceValue - moodValue) > 0.01) {
              return false;
            }
          } else if (deviceValue !== moodValue) {
            return false;
          }
        }
      }
      this.log(`Mood ${mood.id} is active`);
      return true;
    });
  }

};

export const testProviderConfig = {
    WAN_SPACE_ID: 'Saravutw/WAN2.2_I2V_LIGHTNING_4-8step_custom', WAN_SPACE_REVISION: 'a'.repeat(40),
    WAN_MODEL_ID: 'test/approved-wan', WAN_MODEL_REVISION: 'b'.repeat(40)
};
export const testProviderMetadata = { sha: testProviderConfig.WAN_SPACE_REVISION, runtime: { sha: testProviderConfig.WAN_SPACE_REVISION } };
export const testProviderSettings = { slop_model: { id: testProviderConfig.WAN_MODEL_ID, revision: testProviderConfig.WAN_MODEL_REVISION } };

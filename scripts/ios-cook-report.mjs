// Independent transport validation: a passing top-level bit never substitutes
// for the real app's navigation, ingredient, voice and data-retention checks.
export const cookRequiredFlags=Object.freeze([
 'nativeOrigin','cookMounted','cookReady','navPresent','navVisible','navHit',
 'backToPlan','dataKept','mainReady','startupReady','ingredientClosed',
 'ingredientPhoto','ingredientSaved','ingredientAutofill','ingredientExistingKept',
 'ingredientRestored','voiceFreeLocked','voiceManualStart','voiceNextStep',
 'voiceTimer','voiceScaledAmount','voiceExitStopped','voiceRestored',
 'voicePrepAvailable','voicePrepNarrated','voicePrepAdvanced','voiceCookNarrated','voiceStepNarrated',
 'mentorAvailable','mentorRecipeContext','mentorSpokenQuestion','mentorTypedQuestion',
 'mentorFollowupHistory','mentorPrivateAudio','mentorAnswerVisible','mentorNoAutonomousActions',
 'mentorCancelledAnswer','mentorInterrupt','mentorHistoryCleared','mentorNoDeviceFallback','mentorGreetingName'
]);
export function cookReportFailure(report){
 if(report?.complete!==true)return 'report_timeout';
 if(report.passed!==true||report.legacyVisible!==false||cookRequiredFlags.some(key=>report[key]!==true))return 'ui_failed';
 return '';
}

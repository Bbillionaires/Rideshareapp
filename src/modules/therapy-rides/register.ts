import { registerRideCompletionHook } from "../rides/hooks";
import { applyTherapyFeeToRide } from "./engine";

registerRideCompletionHook(applyTherapyFeeToRide);

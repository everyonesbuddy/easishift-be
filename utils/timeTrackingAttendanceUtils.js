const getAttendanceOutcomeForClockOut = ({
  scheduledEndTime,
  clockOutAt,
  clockOutGraceMinutes,
}) => {
  if (!scheduledEndTime || !clockOutAt) return "completed";

  const earlyCheckoutCutoff = new Date(
    new Date(scheduledEndTime).getTime() - clockOutGraceMinutes * 60 * 1000,
  );

  return clockOutAt < earlyCheckoutCutoff ? "left_early" : "completed";
};

module.exports = {
  getAttendanceOutcomeForClockOut,
};

import { styled, Switch, SwitchProps } from "@mui/material";
import { Dispatch, SetStateAction } from "react";

type PaddingConfigs = {
  left: string;
  right: string;
};


interface BorrowLendToggleProps extends SwitchProps {
  isInLendingMode: boolean;
  setIsInLendingMode: Dispatch<SetStateAction<boolean>>;
  leftTitle?: string;
  rightTitle?: string;
  paddingConfigs?: PaddingConfigs;
}

const BorrowLendToggle = styled(({
  isInLendingMode,
  setIsInLendingMode,
  leftTitle = "Lend",
  rightTitle = "Borrow",
  paddingConfigs = {
    "left": "27px",
    "right": "18px"
  },
  ...switchProps
}: BorrowLendToggleProps) => {
  const handleChange = () => {
    setIsInLendingMode((prev) => !prev);
  };

  return (
    <Switch
      focusVisibleClassName=".Mui-focusVisible"
      disableRipple
      {...switchProps}
      checked={!isInLendingMode}
      onChange={handleChange}
    />
  );
})(({
  disabled,
  leftTitle = "Lend",
  rightTitle = "Borrow",
  paddingConfigs = {
    "left": "27px",
    "right": "18px"
  }
}) => ({
  width: 166.34, //
  height: 52.04,
  ...(disabled ? { cursor: "not-allowed" } : {}),
  padding: 0,
  borderRadius: 43.61,
  backgroundColor: "rgba(0,0,0,1)", // @todo currently transparency is at 1 to hide the center thing that i can't make disappear
  border: "solid rgba(255, 255, 255, 0.20) 1px",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  paddingLeft: paddingConfigs.left,
  paddingRight: paddingConfigs.right,
  "&:after": {
    content: `'${rightTitle}'`,
    zIndex: 10,
    pointerEvents: "none",
    fontFamily: "Aeonik Pro",
    fontWeight: 500,
  },
  "&:before": {
    content: `'${leftTitle}'`,
    zIndex: 10,
    pointerEvents: "none",
    fontFamily: "Aeonik Pro",
    fontWeight: 500,
  },
  "& .MuiSwitch-switchBase": {
    padding: 0,
    marginTop: "0.28rem",
    marginLeft: "0.3rem",
    width: "48%",
    height: "80%",
    borderRadius: 43.61,
    display: "flex",
    justifyContent: "center",
    transitionDuration: "300ms", // ios transition time
    "&.Mui-checked": {
      transform: "translateX(4.66rem)",
      color: "#fff",
      "& + .MuiSwitch-track": {
        backgroundColor: "rgba(0,0,0,0)",
        opacity: 0,
        border: 0,
      },
      "&.Mui-disabled + .MuiSwitch-track": {
        opacity: 0.5,
      },
    },
  },
  "& .MuiSwitch-thumb": {
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    borderRadius: 43.61,
    backgroundColor: "#2F373D",
    border: "solid rgba(255, 255, 255, 0.2) 1px",
  },
}));

export { BorrowLendToggle };

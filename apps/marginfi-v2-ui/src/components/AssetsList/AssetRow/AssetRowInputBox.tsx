import { TextField, InputAdornment, Button } from "@mui/material";
import { FC, MouseEvent } from "react";
import { NumberFormatValues, NumericFormat } from "react-number-format";
import { toast } from "react-toastify";

interface AssetRowInputBox {
  value: number;
  setValue: (value: number) => void;
  maxValue?: number;
  disabled?: boolean;
}

const AssetRowInputBox: FC<AssetRowInputBox> = ({
  value,
  setValue,
  maxValue,
  disabled,
}) => {
  const onMaxClick = () => {
    if (maxValue !== undefined) {
      setValue(maxValue);
    } else {
      toast.error("Not implemented");
    }
  };

  const onChange = (event: NumberFormatValues) => {
    const updatedAmountStr = event.value;
    if (updatedAmountStr !== "" && !/^\d*\.?\d*$/.test(updatedAmountStr))
      return;
    const updatedAmount = Number(updatedAmountStr);
    setValue(updatedAmount);
  };

  return (
    <NumericFormat
      value={value}
      placeholder="0"
      allowNegative={false}
      decimalScale={6}
      disabled={disabled}
      onValueChange={onChange}
      thousandSeparator=","
      customInput={TextField}
      size="small"
      max={maxValue}
      InputProps={{
        className:
          "bg-[#1C2125] text-[#515151] text-sm rounded-lg pr-0 w-50 h-12 font-light",
        style: {
          fontFamily: "Aeonik Pro",
        },
        endAdornment: (
          <MaxInputAdornment onClick={onMaxClick} disabled={disabled} />
        ),
      }}
    />
  );
};

// @todo not happy with how this looks on small screens
const MaxInputAdornment: FC<{
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}> = ({ onClick, disabled }) => (
  <InputAdornment position="end">
    <Button
      classes={{
        root: "p-0 text-[#868E95] text-xs lowercase h-9 font-light",
      }}
      style={{
        fontFamily: "Aeonik Pro",
      }}
      sx={{ "&:hover": { backgroundColor: "transparent" } }}
      onClick={onClick}
      variant="text"
      disableRipple
      disabled={disabled}
    >
      max
    </Button>
  </InputAdornment>
);

export { AssetRowInputBox };

import { InputAdornment, TextField } from "@mui/material";
import { FC, MouseEventHandler } from "react";
import { NumberFormatValues, NumericFormat } from "react-number-format";

interface UserPositionRowInputBoxProps {
  value: number;
  setValue: (value: number) => void;
  maxValue?: number;
  maxDecimals?: number;
}

const UserPositionRowInputBox: FC<UserPositionRowInputBoxProps> = ({ value, setValue, maxValue, maxDecimals }) => {
  const onClick = () => {
    if (maxValue !== undefined) {
      setValue(maxValue);
    }
  };

  const onChange = (event: NumberFormatValues) => {
    const updatedAmountStr = event.value;
    if (updatedAmountStr !== "" && !/^\d*\.?\d*$/.test(updatedAmountStr)) return;
    const updatedAmount = Number(updatedAmountStr);
    if (maxValue !== undefined && updatedAmount > maxValue) {
      setValue(maxValue);
      return;
    }
    setValue(updatedAmount);
  };

  return (
    <NumericFormat
      value={value}
      placeholder="0"
      allowNegative={false}
      decimalScale={maxDecimals}
      onValueChange={onChange}
      thousandSeparator=","
      customInput={TextField}
      size="small"
      max={maxValue}
      InputProps={{
        className: "font-aeonik min-w-[150px] h-12 mx-3 px-0 bg-[#1C2125] text-[#e1e1e1] text-sm font-light rounded-lg",
        endAdornment: <MaxInputAdornment onClick={onClick} />,
      }}
    />
  );
};

// @todo not happy with how this looks on small screens
const MaxInputAdornment: FC<{
  onClick: MouseEventHandler<HTMLDivElement>;
}> = ({ onClick }) => (
  <InputAdornment position="end" classes={{ root: "max-w-[40px] h-full" }}>
    <div
      className="font-aeonik p-0 pr-4 text-[#868E95] text-sm lowercase h-9 font-light flex justify-center items-center hover:bg-transparent cursor-pointer"
      onClick={onClick}
    >
      max
    </div>
  </InputAdornment>
);

export { UserPositionRowInputBox };

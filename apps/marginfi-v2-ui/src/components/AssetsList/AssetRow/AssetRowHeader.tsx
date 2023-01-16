import { TableCell } from "@mui/material";
import { FC } from "react";
import { percentFormatter } from "~/utils";
import Image from "next/image";

interface AssetRowHeader {
  assetName: string;
  apy: number;
  icon?: string;
  textBold?: boolean;
}

const AssetRowHeader: FC<AssetRowHeader> = ({
  assetName,
  apy,
  icon,
  textBold,
}) => (
  <TableCell className="text-white h-full w-full border-hidden max-w-fit pr-0 lg:pr-20">
    <div
      className="h-full w-full flex justify-center p-0 text-white"
      style={{
        flexDirection: icon ? "row" : "column",
        alignItems: icon ? "center" : "flex-start",
        justifyContent: icon ? "flex-start" : "center",
      }}
    >
      {icon && (
        <Image
          src={`/${icon}`}
          alt={icon}
          height={"15"}
          width={"15"}
          className="mr-2"
        />
      )}
      <div>
        <div
          style={{
            fontFamily: 'Aeonik Pro',
            fontWeight: textBold ? 400 : 300,
          }}
        >
          {assetName}
        </div>
      </div>
      <div
        // @todo font size here should technically be smaller, but tailwind doesn't offer smaller sizing
        // pointing to a likely readibility problem.
        // resolve with design.
        className="px-1 text-xs text-[#868E95] hidden lg:flex"
        style={{
          fontFamily: 'Aeonik Pro',
          fontWeight: textBold ? 400 : 300,
        }}
      >
        Current APY
      </div>
      <div
        // @todo font size here should technically be smaller, but tailwind doesn't offer smaller sizing
        // pointing to a likely readibility problem.
        // resolve with design.
        className="flex justify-center items-center px-1 text-[#3AFF6C] bg-[#3aff6c1f] rounded-xl text-xs"
        style={{
          fontFamily: 'Aeonik Pro',
          fontWeight: textBold ? 400 : 300,
        }}
      >
        {percentFormatter.format(apy)}
      </div>
    </div>
  </TableCell>
);

export { AssetRowHeader };
